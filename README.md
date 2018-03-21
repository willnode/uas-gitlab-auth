# uas-gitlab-auth

Microservice to grant access to GitLab private repo using Asset Store Invoice API.

This microservice can handle multiple assets under the same publisher.

## Deploy

[![Deploy to now](https://deploy.now.sh/static/button.svg)](https://deploy.now.sh/?repo=https://github.com/willnode/uas-gitlab-auth&env=UAS_TOKEN&env=GITLAB_TOKEN&env=UAS_ASSETS&env=GITLAB_REPOS&env=ACCESS_ALLOW_ORIGIN)

OR

```
$ now -e NODE_ENV=production -e UAS_TOKEN=xxxx -e GITLAB_TOKEN=xxxx -e UAS_ASSETS=xxxx -e GITLAB_REPOS=xxxx -e ACCESS_ALLOW_ORIGIN=xxxx
```

OR

Deploy to your hosting provider, set the below environment variables, and start it with `npm start`.

## Enviroment Variables

- `UAS_TOKEN` - [Unity Asset Store Verify Invoice Token](https://publisher.assetstore.unity3d.com/verify-invoice.html#apiKeyValue).
- `GITLAB_TOKEN` - [GitLab Token with API Access](https://gitlab.com/profile/personal_access_tokens).
- `UAS_ASSETS` - Name of Assets that permitted. Multiple Assets can be separated with comma. Names should match with [names returned from API](http://api.assetstore.unity3d.com/api-docs/#!/invoice).
- `GITLAB_REPOS` - GitLab repo IDs (number not name) to be granted, in the same order with `UAS_ASSETS`.
- `ACCESS_ALLOW_ORIGIN` - The URL of your website or `*` if you want to allow any origin (not recommended), for the `Access-Control-Allow-Origin` header.

Below are optional options to finetune access grants. If you set any non-empty value on these variables, it'll assumed as `true` (default is not set or `false` to prevent abuse and potential pirates):

- `ALLOW_EDIT_AND_DELETE` - Allow user to override or delete if that user has entered Invoices that already exist in the data.
- `ALLOW_FREE_USERS` - Grant access to users that purchase with zero price (e.g. voucher redeem).
- `ALLOW_REFUNDED_USERS` - Grant access to users that **has** refunded their purchase.

Other optional nice environment variables:

- `RECAPTCHA_TOKEN` - [Google Recaptcha](https://www.google.com/recaptcha/) secret token if you plan to use recaptcha.
- `SUCCESS_REDIRECT_TO` - If operation success, redirect user to a specific URL. It'll automatically appended with `?repo=xxx` where `xxx` is repo ID.

By design it only grant one user per one invoice.

## API

When you give GitLab token to this microservice, it will:

+ Grant any registered GitLab user with correct Invoice number as `guest` to the repo.
+ Autogenerate wiki called `granted_invoices` to save a prettified JSON data about invoice numbers that related to each granted GitLab user.

This microservice speaks `POST`. If you use `GET` any operation will not modify target repo nor modify grant to user (useful for installation testing).

Required Request Parameters:

- `invoice`: Invoice number.
- `username`: GitLab registered Username. If not set or empty and `ALLOW_EDIT_AND_DELETE` is set the operation will delete the invoice number from data and revoking the user access.

## CLient Example

HTML Only:

```html
<form action="https://uas-gitlab-auth-xxxxx.now.sh" method="post">
  Invoice: <input type="text" name="invoice"><br>
  Username: <input type="text" name="username"><br>
  <input type="submit" value="Submit">
</form>
```

XHR:

```js
const invoice='0123', username='smith';
const xhr = new XMLHttpRequest();
xhr.onreadystatechange = function() {
    if (this.readyState == 4) {
       console.log(this.status);
       console.log(xhr.responseText);
    }
};

xhr.open('POST', 'https://uas-gitlab-auth-xxxxx.now.sh', true);
xhr.send(`invoice=${invoice}&username=${username}`);
```

## Return

The microservice will respond with human message in the body and either of these codes:

- `200`: Access granted.
- `202`: Request valid without any modification in repo (e.g. API performed via `GET` or user already been granted)
- `400`: Wrong or invalid request (e.g. malformed invoice pattern)
- `403`: Request rejected (e.g. invoice didn't found, repo didn't match, etc.)
- `500`: Internal error (e.g. token has expired or an issue with the microservice). Check for logs if a user spot this error.

## License

MIT.
