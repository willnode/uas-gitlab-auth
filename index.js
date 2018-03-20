const micro = require('micro');
const url = require('url');
const controlAccess = require('control-access');
const got = require('got');

const uas = {
    token: process.env.UAS_TOKEN,
    assets: (process.env.UAS_ASSETS || '').split(','),
};

const gitlab = {
    token: process.env.GITLAB_TOKEN,
    repos: (process.env.GITLAB_REPOS || '').split(','),
};

const options = {
    allowEditAndDelete: new Boolean(process.env.ALLOW_EDIT_AND_DELETE),
    allowFree: new Boolean(process.env.ALLOW_FREE_USERS),
    allowRefunded: new Boolean(process.env.ALLOW_REFUNDED_USERS),
}

require('./verify')(uas, gitlab);

