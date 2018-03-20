const micro = require('micro');
const url = require('url');
const controlAccess = require('control-access');
const got = require('got');
const bodyparser = require('urlencoded-body-parser')

const uas = {
    token: process.env.UAS_TOKEN,
    assets: (process.env.UAS_ASSETS || '').split(','),
};

const gitlab = {
    token: process.env.GITLAB_TOKEN,
    tokenHead: {
        "PRIVATE-TOKEN": process.env.GITLAB_TOKEN
    },
    repos: (process.env.GITLAB_REPOS || '').split(','),
};

const options = {
    allowEditAndDelete: Boolean(process.env.ALLOW_EDIT_AND_DELETE),
    allowFree: Boolean(process.env.ALLOW_FREE_USERS),
    allowRefunded: Boolean(process.env.ALLOW_REFUNDED_USERS),
}

require('./verify')(uas, gitlab);

const invoice_uri = 'http://api.assetstore.unity3d.com/publisher/v1/invoice/verify.json';
const gitlab_uri = 'https://gitlab.com/api/v4';
const wiki_slug = 'granted_invoices';

const respond = function (response, code, text) {
    response.statusCode = code;
    return text;
}

module.exports = async (request, response) => {
    controlAccess()(request, response);

    const grantModify = request.method === `POST`;
    const url_parts = url.parse(request.url, true);
    const qs_parts = grantModify ? await bodyparser(request) : url_parts.query;
    const invoice = qs_parts.invoice;
    const username = qs_parts.username;

    // Sanitization

    if (url_parts.pathname !== '/') {
        return respond(response, 400, '');
    } else if (!invoice) {
        return respond(response, 400, `Invoice number is required`);
    } else if ((!username) && (!options.allowEditAndDelete)) {
        return respond(response, 400, `Username is required`);
    } else if (!/^\d+$/.test(invoice)) {
        return respond(response, 400, `Invalid invoice format. Must only contain digits`);
    } else if (!/^[\w\d_-]+$/.test(username)) {
        return respond(response, 400, `Invalid character(s) in username`);
    }

    // Check Invoice

    let repo, package;

    try {
        const result = await got(`${invoice_uri}?key=${uas.token}&invoice=${invoice}`);
        const parsed = JSON.parse(result.body);
        if (parsed.invoices.length == 0) {
            return respond(response, 403, `Invoice is not available`);
        }
        const user = parsed.invoices[0];
        if (!options.allowRefunded && user.refunded === 'Yes') {
            return respond(response, 403, `Refunded invoice can't be granted`);
        } else if (!options.allowFree && user.price_exvat === '0.00') {
            return respond(response, 403, `Voucher-redeemed invoice can't be granted`);
        }
        const targetIdx = uas.assets.indexOf(package = user.package);
        if (targetIdx < 0) {
            return respond(response, 403, `Invoice available, but repository '${package}' is not found`);
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
            const result = await got(`${gitlab_uri}/users?username=${username}`);
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

    try {
        const result = await got(`${gitlab_uri}/projects/${repo}/wikis/${wiki_slug}`, {
            headers: gitlab.tokenHead,
            throwHttpErrors: false,
        });
        if (result.statusCode === 404) {
            // didn't exist. create if POST
            if (grantModify) {
                await got.post(`${gitlab_uri}/projects/${repo}/wikis`, {
                    body: `title=${wiki_slug}&content={}`,
                    headers: gitlab.tokenHead,
                });
                users = {};
            } else {
                return respond(response, 202, `Will not grant because wiki '${wiki_slug}' didn't exist. Use POST instead.`);
            }
        } else {
            users = JSON.parse(JSON.parse(result.body)[0].content);
        }
    } catch (error) {
        console.log(error.response ? error.response.body : error);
        return respond(response, 500, `Server has failed from reaching or parsing GitLab Wiki API`);
    }

    // Modify wiki

    let olduserid;

    if (olduserid = users[invoice]) {
        if (olduserid === userid) {
            return respond(response, 202, `Username ${username} already have a grant access to repo '${package}'`);
        }
        else if (options.allowEditAndDelete) {
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
            return respond(response, 403, `Invoice already been granted with user id '${users[invoice]}', hence can't be altered`);
        }
    } else {
        if (grantModify) {
            users[invoice] = userid;
        } else {
            return respond(response, 202, `Invoice will be granted if request sent with POST`);
        }
    }

    // Push wiki modification

    try {
        const result = await got.put(`${gitlab_uri}/projects/${repo}/wikis/${wiki_slug}`, {
            headers: gitlab.tokenHead,
            body: `content=${encodeURIComponent(JSON.stringify(users, null, 2))}`
        });
    } catch (error) {
        console.log(error.response ? error.response.body : error);
        return respond(response, 500, `Server has failed to push Wiki modification from GitLab API`);
    }

    // Revoke old user, if exist
    if (olduserid) {
        try {
            const result = await got(`${gitlab_uri}/projects/${repo}/members/${olduserid}`, {
                headers: gitlab.tokenHead,
                throwHttpErrors: false,
            });
            if (response.statusCode === 200) {
                await got.delete(`${gitlab_uri}/projects/${repo}/members/${olduserid}`, {
                    headers: gitlab.tokenHead,
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
            await got.post(`${gitlab_uri}/projects/${repo}/members`, {
                body: `user_id=${userid}&access_level=10`,
                headers: gitlab.tokenHead,
            });
        } catch (error) {
            console.log(error.response ? error.response.body : error);
            return respond(response, 500, `Server has failed to grant the access from GitLab API`);
        }
    }

    response.end('Access Granted');
};

