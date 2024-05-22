import { ServerResponse, IncomingMessage } from 'http';

import { parse } from 'url';
import controlAccess from './cors';
import { db, gitlab, gitlabURI, invoiceURI, options, recaptchaURI, uas } from './config';


const parseUrlEncodedBody = async (request: IncomingMessage) => {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString();
  return Object.fromEntries(new URLSearchParams(body));
};

const respond = (response: ServerResponse, code: number, text: string) => {
  response.statusCode = code;
  response.end(text);
};

export const handler = async (request: IncomingMessage, response: ServerResponse) => {
  controlAccess()(request, response);

  const grantModify = request.method === 'POST';
  const partsURL = parse(request.url || '/', true);
  let partsQS;

  if (grantModify) {
    partsQS = await parseUrlEncodedBody(request);
  } else {
    partsQS = partsURL.query;
  }

  let invoice = partsQS.invoice + "";
  const username = partsQS.username + "";

  // Sanitization
  if (partsURL.pathname !== '/') {
    return respond(response, 400, '');
  }
  if (!invoice) {
    return respond(response, 400, 'Invoice number is required');
  }
  if ((!username) && (!options.allowEditAndDelete)) {
    return respond(response, 400, 'Username is required');
  }
  if (invoice.startsWith('IN')) {
    invoice = invoice.substring(2);
  }
  if (!/^\d+$/.test(invoice)) {
    return respond(response, 400, 'Invalid invoice format. Must only contain digits');
  }
  if (username && !/^[\w\d_-]+$/.test(username)) {
    return respond(response, 400, 'Invalid character(s) in username');
  }

  // Recaptcha (optional)
  if (options.recaptchaToken) {
    try {
      const recap = partsQS['g-recaptcha-response'];
      if (!recap) {
        return respond(response, 400, 'Missing Recaptcha');
      }
      const result = await fetch(recaptchaURI, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: `secret=${options.recaptchaToken}&response=${recap}`
      });
      const parsed = await result.json();
      if (!parsed.success) {
        return respond(response, 403, 'Recaptcha verification failed');
      }
    } catch (error) {
      console.log(error);
      return respond(response, 500, 'Server has failed from reaching Google Recaptcha API');
    }
  }

  // Check Invoice
  let repo;
  let packagename;

  try {
    const result = await fetch(`${invoiceURI}?key=${uas.token}&invoice=${invoice}`);
    const parsed = await result.json();
    if (parsed.invoices.length === 0) {
      return respond(response, 403, 'Invoice is not available');
    }
    const user = parsed.invoices[0];
    if (!options.allowRefunded && user.refunded === 'Yes') {
      return respond(response, 403, "Refunded invoice can't be granted");
    }
    if (!options.allowFree && user.price_exvat === '0.00') {
      return respond(response, 403, "Voucher-redeemed invoice can't be granted");
    }
    const targetIdx = uas.assets.indexOf(packagename = user.package);
    if (targetIdx < 0) {
      return respond(response, 403, `Invoice available, but repository '${packagename}' is not found`);
    }

    repo = gitlab.repos[targetIdx];
  } catch (error) {
    console.log(error);
    return respond(response, 500, 'Server has failed from reaching Unity Invoice API');
  }

  // Check username validity
  let userid;

  if (username) {
    try {
      const result = await fetch(`${gitlabURI}/users?username=${username}`);
      const parsed = await result.json();
      if (parsed.length > 0) {
        userid = parsed[0].id;
      } else {
        return respond(response, 403, `Username '${username}' does not exist in GitLab`);
      }
    } catch (error) {
      console.log(error);
      return respond(response, 500, 'Server has failed from reaching or parsing GitLab Users API');
    }
  }

  // Check or create invoice entry in database
  let dbInvoice = await db('invoices').where({ invoice }).first();

  if (dbInvoice) {
    if (dbInvoice.userid === userid) {
      return respond(response, 202, `User '${username}' already has access to repo '${packagename}'`);
    }
    if (options.allowEditAndDelete) {
      if (grantModify) {
        if (username) {
          await db('invoices').where({ invoice }).update({ userid });
        } else {
          await db('invoices').where({ invoice }).del();
        }
      } else {
        return respond(response, 202, `Invoice grant will be successfully overridden if request sent with POST`);
      }
    } else {
      return respond(response, 403, `Invoice already granted with user ID '${dbInvoice.userid}', hence can't be altered`);
    }
  } else if (grantModify) {
    await db('invoices').insert({ invoice, userid });
  } else {
    return respond(response, 202, `User '${username}' will be granted access to repo '${packagename}' if request sent with POST`);
  }

  const gitlabRepoURI = `${gitlabURI}/projects/${repo}`;

  // Revoke old user, if exist
  if (dbInvoice && dbInvoice.userid) {
    try {
      const result = await fetch(`${gitlabRepoURI}/members/${dbInvoice.userid}`, {
        headers: gitlab.tokenHead,
        method: 'GET'
      });
      if (result.status === 200) {
        await fetch(`${gitlabRepoURI}/members/${dbInvoice.userid}`, {
          headers: gitlab.tokenHead,
          method: 'DELETE'
        });
      }
    } catch (error) {
      console.log(error);
      return respond(response, 500, 'Server has failed to revoke access of old user from GitLab API');
    }
  }

  // Grant new user
  if (username) {
    try {
      await fetch(`${gitlabRepoURI}/members`, {
        method: 'POST',
        headers: gitlab.tokenHead,
        body: JSON.stringify({ access_level: 10, user_id: userid })
      });
    } catch (error) {
      console.log(error);
      return respond(response, 500, 'Server has failed to grant access from GitLab API');
    }
  }

  if (options.redirectionURI) {
    response.writeHead(301, {
      location: `${options.redirectionURI}?repo=${repo}`
    });
  }

  response.end('Success! Login to https://gitlab.com/ and check the invitation!');
};
