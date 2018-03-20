// Checks

module.exports = function (uas, gitlab) {
	if (!uas.token) {
		throw new Error('Please set UAS_TOKEN');
	}

	if (!gitlab.token) {
		throw new Error('Please set GITLAB_TOKEN');
	}

	if (!process.env.ACCESS_ALLOW_ORIGIN) {
		throw new Error('Please set ACCESS_ALLOW_ORIGIN');
	}

	if (!process.env.UAS_ASSETS) {
		throw new Error('Please set UAS_ASSETS');
	}

	if (!process.env.GITLAB_REPOS) {
		throw new Error('Please set GITLAB_REPOS');
	}

	if (uas.assets.length !== gitlab.repos.length) {
		throw new Error(`UAS_ASSETS has ${uas.assets.length} while GITLAB_REPOS has ${gitlab.repos.length}. Check if both has the same count in commas.`);
	}

	if (!uas.assets.every(x => x) || !gitlab.repos.every(x => x)) {
		throw new Error('Either UAS_ASSETS or GITLAB_REPOS has empty value(s) when parsed as CSV.');
	}
};
