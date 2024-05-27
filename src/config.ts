import knex from "knex";

export const db = knex({
    client: 'pg',
    connection: {
        host: process.env.PG_HOST,
        user: process.env.PG_USER,
        password: process.env.PG_PASSWORD,
        database: process.env.PG_DATABASE
    }
});

export const uas = {
    token: process.env.UAS_TOKEN || '',
    assets: (process.env.UAS_ASSETS || '').split(',')
};

export const gitlab = {
    token: process.env.GITLAB_TOKEN,
    tokenHead: {
        'PRIVATE-TOKEN': process.env.GITLAB_TOKEN || '',
        'content-type': 'application/json',
    },
    repos: (process.env.GITLAB_REPOS || '').split(',')
};

export const options = {
    allowEditAndDelete: Boolean(process.env.ALLOW_EDIT_AND_DELETE),
    allowFree: Boolean(process.env.ALLOW_FREE_USERS),
    allowRefunded: Boolean(process.env.ALLOW_REFUNDED_USERS),
    redirectionURI: process.env.SUCCESS_REDIRECT_TO,
    recaptchaToken: process.env.RECAPTCHA_TOKEN,
    port: parseInt(process.env.PORT || '3000'),
};

export const invoiceURI = 'http://api.assetstore.unity3d.com/publisher/v1/invoice/verify.json';
export const gitlabURI = 'https://gitlab.com/api/v4';
export const recaptchaURI = 'https://www.google.com/recaptcha/api/siteverify';

export async function fetchIt(url: string | Request | URL, init?: FetchRequestInit | undefined): Promise<Response> {
    try {
        var result = await fetch(url, init);
        if (!result.ok) {
            throw new Error("Error fetch: " + (await result.text()));
        }
        return result;
    } catch (error: any) {
        console.error(error);
        throw error;
    }
} 
