const url = require('url');
const got = require('got');
const bodyparser = require('urlencoded-body-parser');
const controlAccess = require('control-access');

const uas = {
	token: process.env.UAS_TOKEN,
	assets: (process.env.UAS_ASSETS || '').split(',')
};

const gitlab = {
	token: process.env.GITLAB_TOKEN,
	tokenHead: {
		'PRIVATE-TOKEN': process.env.GITLAB_TOKEN
	},
	repos: (process.env.GITLAB_REPOS || '').split(',')
};

const options = {
	allowEditAndDelete: Boolean(process.env.ALLOW_EDIT_AND_DELETE),
	allowFree: Boolean(process.env.ALLOW_FREE_USERS),
	allowRefunded: Boolean(process.env.ALLOW_REFUNDED_USERS),
	redirectionURI: process.env.SUCCESS_REDIRECT_TO,
	recaptchaToken: process.env.RECAPTCHA_TOKEN
};

require('./verify')(uas, gitlab);

const invoiceURI = 'http://api.assetstore.unity3d.com/publisher/v1/invoice/verify.json';
const gitlabURI = 'https://gitlab.com/api/v4';
const recaptchaURI = 'https://www.google.com/recaptcha/api/siteverify';
const wikiSlug = 'granted_invoices';

const respond = function (response, code, text) {
	response.statusCode = code;
	response.end(text);
};

const handler = async (request, response) => {
	controlAccess()(request, response);

	const grantModify = request.method === `POST`;
	const partsURL = url.parse(request.url, true);
	const partsQS = grantModify ? await bodyparser(request) : partsURL.query;
	const invoice = partsQS.invoice;
	const username = partsQS.username;

	// Sanitization

	if (partsURL.pathname !== '/') {
		return respond(response, 400, '');
	}
	if (!invoice) {
		return respond(response, 400, `Invoice number is required`);
	}
	if ((!username) && (!options.allowEditAndDelete)) {
		return respond(response, 400, `Username is required`);
	}
	if (!/^\d+$/.test(invoice)) {
		return respond(response, 400, `Invalid invoice format. Must only contain digits`);
	}
	if (!/^[\w\d_-]+$/.test(username)) {
		return respond(response, 400, `Invalid character(s) in username`);
	}

	// Recaptcha (optional)

	if (options.recaptchaToken) {
		try {
			const recap = partsQS['g-recaptcha-response'];
			if (!recap) {
				return respond(response, 400, `Missing Recaptcha`);
			}
			const result = await got.post(recaptchaURI, {
				headers: {
					'content-type': 'application/x-www-form-urlencoded'
				},
				body: `secret=${options.recaptchaToken}&response=${recap}`
			});
			const parsed = JSON.parse(result.body);
			if (!parsed.success) {
				return respond(response, 403, `Recaptcha verification failed`);
			}
		} catch (error) {
			console.log(error.response ? error.response.body : error);
			return respond(response, 500, `Server has failed from reaching Google Recaptcha API`);
		}
	}

	// Check Invoice

	let repo;
	let packagename;

	try {
		const result = await got(`${invoiceURI}?key=${uas.token}&invoice=${invoice}`);
		const parsed = JSON.parse(result.body);
		if (parsed.invoices.length === 0) {
			return respond(response, 403, `Invoice is not available`);
		}
		const user = parsed.invoices[0];
		if (!options.allowRefunded && user.refunded === 'Yes') {
			return respond(response, 403, `Refunded invoice can't be granted`);
		}
		if (!options.allowFree && user.price_exvat === '0.00') {
			return respond(response, 403, `Voucher-redeemed invoice can't be granted`);
		}
		const targetIdx = uas.assets.indexOf(packagename = user.package);
		if (targetIdx < 0) {
			return respond(response, 403, `Invoice available, but repository '${packagename}' is not found`);
		}

		repo = gitlab.repos[targetIdx];
	} catch (error) {
		console.log(error.response ? error.response.body : error);
		return respond(response, 500, `Server has failed from reaching Unity Invoice API`);
	}

	// Check username validity

	let userid;

	if (username) {
		try {
			const result = await got(`${gitlabURI}/users?username=${username}`);
			const parsed = JSON.parse(result.body);
			if (parsed.length > 0) {
				userid = parsed[0].id;
			} else {
				return respond(response, 403, `Username '${username}' is not exist in GitLab`);
			}
		} catch (error) {
			console.log(error.response ? error.response.body : error);
			return respond(response, 500, `Server has failed from reaching or parsing GitLab Users API`);
		}
	}

	// Check wiki

	let users;
	const gitlabRepoURI = `${gitlabURI}/projects/${repo}`;

	try {
		const result = await got(`${gitlabRepoURI}/wikis/${wikiSlug}`, {
			headers: gitlab.tokenHead,
			throwHttpErrors: false
		});
		if (result.statusCode === 404) {
			// Didn't exist. create if POST
			if (grantModify) {
				await got.post(`${gitlabRepoURI}/wikis`, {
					body: `title=${wikiSlug}&content={}`,
					headers: gitlab.tokenHead
				});
				users = {};
			} else {
				return respond(response, 202, `Will not grant because wiki '${wikiSlug}' didn't exist. Use POST instead.`);
			}
		} else {
			const content = JSON.parse(result.body).content;
			try {
				users = JSON.parse(content);
			} catch (error) {
				// Maybe edited by hand?
				return respond(response, 500, `Server has failed from parsing '${wikiSlug}' because:\n${error}`);
			}
		}
	} catch (error) {
		console.log(error.response ? error.response.body : error);
		return respond(response, 500, `Server has failed from reaching or parsing GitLab Wiki API`);
	}

	// Modify wiki

	const olduserid = users[invoice];

	if (olduserid) {
		if (olduserid === userid) {
			return respond(response, 202, `User '${username}' already has an access to repo '${packagename}'`);
		}
		if (options.allowEditAndDelete) {
			if (grantModify) {
				if (username) {
					users[invoice] = userid;
				} else {
					delete users[invoice];
				}
			} else {
				return respond(response, 202, `Invoice grant will successfully overrided if request sent with POST`);
			}
		} else {
			return respond(response, 403, `Invoice already been granted with user ID '${users[invoice]}', hence can't be altered`);
		}
	} else if (grantModify) {
		users[invoice] = userid;
	} else {
		return respond(response, 202, `User '${username}' will be granted to repo '${packagename}' if request sent with POST`);
	}

	// Push wiki modification

	try {
		await got.put(`${gitlabRepoURI}/wikis/${wikiSlug}`, {
			headers: {
				'PRIVATE-TOKEN': gitlab.token,
				'CONTENT-TYPE': 'application/json'
			},
			body: JSON.stringify({
				title: wikiSlug,
				content: JSON.stringify(users, null, 2)
			})
		});
	} catch (error) {
		console.log(error.response ? error.response.body : error);
		return respond(response, 500, `Server has failed to push Wiki modification from GitLab API`);
	}

	// Revoke old user, if exist

	if (olduserid) {
		try {
			await got(`${gitlabRepoURI}/members/${olduserid}`, {
				headers: gitlab.tokenHead,
				throwHttpErrors: false
			});
			if (response.statusCode === 200) {
				await got.delete(`${gitlabRepoURI}/members/${olduserid}`, {
					headers: gitlab.tokenHead
				});
			}
		} catch (error) {
			console.log(error.response ? error.response.body : error);
			return respond(response, 500, `Server has failed to revoke access of old user from GitLab API`);
		}
	}

	// Grant new user

	if (username) {
		try {
			await got.post(`${gitlabRepoURI}/members`, {
				body: `access_level=10&user_id=${userid}`,
				headers: gitlab.tokenHead,
				throwHttpErrors: false
			});
		} catch (error) {
			console.log(error.response ? error.response.body : error);
			return respond(response, 500, `Server has failed to grant the access from GitLab API`);
		}
	}

	if (options.redirectionURI) {
		response.writeHead(301, {
			location: `${options.redirectionURI}?repo=${repo}`
		});
	}

	response.end('Success! Login to https://gitlab.com/ and check the invitation!');
};

require('http').createServer(handler).listen(8080);
