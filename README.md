# uas-gitlab-auth

Microservice to grant access to GitLab private repo using Asset Store Invoice API.

This microservice can handle multiple assets under the same publisher.

## Deploy

[![Deploy to now](https://deploy.now.sh/static/button.svg)](https://deploy.now.sh/?repo=https://github.com/willnode/uas-gitlab-auth&env=UAS_TOKEN&env=GITLAB_TOKEN&env=UAS_ASSETS&env=GITLAB_REPOS&env=ACCESS_ALLOW_ORIGIN)

OR

```
$ now -e NODE_ENV=production -e UAS_TOKEN -e GITLAB_TOKEN -e UAS_ASSETS -e GITLAB_REPOS -e ACCESS_ALLOW_ORIGIN
```

OR

Deploy to your hosting provider, set the below environment variables, and start it with `npm start`.

## Enviroment Variables

- `UAS_TOKEN` - Unity Asset Invoice Check Token
- `GITLAB_TOKEN` - GitLab Token
- `UAS_ASSETS` - Name of Assets that permitted. Multiple Assets can be separated with comma.
- `GITLAB_REPOS` - GitLab repo IDs to be granted, in the same order with `UAS_ASSETS`.
- `ACCESS_ALLOW_ORIGIN` - The URL of your website or `*` if you want to allow any origin (not recommended), for the `Access-Control-Allow-Origin` header.

Below are optional options to finetune access grants. If you set any non-empty value on these variables, it'll assumed as `true` (default is not set or `false` to prevent abuse and potential pirates):

- `ALLOW_EDIT_AND_DELETE` - Allow user to override or delete if that user has entered Invoices that already exist in the data.
- `ALLOW_FREE_USERS` - Grant access to users that purchase with zero price (e.g. voucher redeem).
- `ALLOW_REFUNDED_USERS` - Grant access to users that **has** refunded their purchase.

By design it only grant one user per one invoice.

## API

When you give GitLab token to this microservice, it will:

+ Grant any registered GitLab user with correct Invoice number as `guest` to the repo.
+ Autogenerate wiki called `granted_invoices.md` to save a prettified JSON data about invoice number that related to given GitLab user. (you can set this wiki as private for privacy)

This microservice speaks `POST`. If you use `GET` any operation will not modify target repo nor modify grant to user (useful for testing).

Required Request Parameters:

- `invoice`: Invoice number
- `username`: GitLab registered Username. If not set or empty and `ALLOW_EDIT_AND_DELETE` the operation delete the invoice number from data and revoking the user access.

The microservice will responding a JSON object with following parameters:

- `status`: (integer) status code (`200` for OK or `403` for denied or `400` for bad request). This also reflected in `xhr.status`.
- `response`: (string) response message for human.

## License

MIT.
