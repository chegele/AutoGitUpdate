
import path from 'path';
import fs from 'fs-extra';
import {spawn, exec} from 'child_process';
import https from 'https';
import appRootPath from 'app-root-path';
import git from 'simple-git';
import Logger from 'simple-logger';

/** 
 * @typedef Config - Configuration for Auto Git Update
 * @param {String} repository - The url to the root of a git repository to update from. 
 * @param {String} branch - The branch to update from. Defaults to master.
 * @param {String} token - A personal access token used for accessions private repositories. 
 * @param {String} tempLocation - The local dir to save temporary information for Auto Git Update.
 * @param {Array[String]} ignoreFiles - An array of files to not install when updating. Useful for config files. 
 * @param {String} executeOnComplete - A command to execute after an update completes. Good for restarting the app.
 * @param {Boolean} exitOnComplete - Use process exit to stop the app after a successful update.
 */let config = {}

// Subdirectories to use within the configured tempLocation from above. 
const cloneSubdirectory = '/AutoGitUpdate/repo/';
const backupSubdirectory = '/AutoGitUpdate/backup/';

// Enable during testing to prevent overwrite of Auto Git Update
const testing = false;

// Create a new simple logger. This can be updated to use a new configuration by calling setLogConfig()
// https://github.com/chegele/Logger
let log = new Logger({});
log.logGeneral = true;
log.logWarning = true;
log.logError   = true;
log.logDetail  = false;
log.logDebug   = false;

export default class AutoGitUpdate {
    /**
     * Creates an object which can be used to automatically update an application from a remote git repository. 
     * @param {Config} updateConfig 
     */
    constructor(updateConfig) {
        // validate config has required properties
        if (updateConfig == undefined) throw new Error('You must pass a config object to AutoGitUpdate.');
        if (updateConfig.repository == undefined) throw new Error('You must include a repository link.');
        if (updateConfig.branch == undefined) updateConfig.branch = 'master';
        if (updateConfig.tempLocation == undefined) throw new Error('You must define a temp location for cloning the repository');

        // Validate that Auto Git Update is being used as a dependency or testing is enabled
        // This is to prevent the Auto Git Update module from being overwritten on accident during development
        if (!testing) {
            let file = path.join(appRootPath.path, 'package.json');
            let appPackage = fs.readFileSync(file);
            appPackage = JSON.parse(appPackage);
            if (appPackage.name == 'auto-git-update') throw new Error('Auto Git Update is not being ran as a dependency & testing is not enabled.');
        }

        config = updateConfig;
    }

    /**
     * Checks local version against the remote version & then updates if different. 
     */
    async autoUpdate() {
        let versionCheck = await this.compareVersions();
        if (versionCheck.upToDate) return true;
        return await this.forceUpdate();
    }

    /**
     * @typedef VersionResults
     * @param {Boolean} UpToDate - If the local version is the same as the remote version.
     * @param {String} currentVersion - The version of the local application.
     * @param {String} remoteVersion - The version of the application in the git repository. 
     * 
     * Checks the local version of the application against the remote repository.
     * @returns {VersionResults} - An object with the results of the version comparison.
     */
    async compareVersions() {
        try {
            log.general('Auto Git Update - Comparing versions...');
            let currentVersion = readAppVersion();
            let remoteVersion = await readRemoteVersion();
            log.general('Auto Git Update - Current version: ' + currentVersion);
            log.general('Auto Git Update - Remote Version: ' + remoteVersion);
            if (currentVersion == remoteVersion) return {upToDate: true, currentVersion};
            return {upToDate: false, currentVersion, remoteVersion};
        }catch(err) {
            log.error('Auto Git Update - Error comparing local and remote versions.');
            log.error(err);
            return {upToDate: false, currentVersion: 'Error', remoteVersion: 'Error'}
        }
    }

    /**
     * Clones the git repository, purges ignored files, and installs the update over the local application.
     * A backup of the application is created before the update is installed.
     * If configured, a completion command will be executed and the process for the app will be stopped. 
     * @returns {Boolean} The result of the update.
     */
    async forceUpdate() {
        try {
            log.general('Auto Git Update - Updating application from ' + config.repository);
            await downloadUpdate();
            await backupApp();
            await installUpdate();
            await installDependencies();
            log.general('Auto Git Update - Finished installing updated version.');
            if (config.executeOnComplete) await promiseBlindExecute(config.executeOnComplete);
            if (config.exitOnComplete) process.exit(1);
            return true;
        }catch(err) {
            log.error('Auto Git Update - Error updating application');
            log.error(err);
            return false;
        }
    }

    /**
     * Updates the simple logger to use the provided configuration. 
     * Reference the readme for configuration options.
     * https://github.com/chegele/Logger
     * @param {Logger.Options} logConfig - An object with the logging configuration
     */
    setLogConfig(logConfig) {
        log = new Logger(logConfig);
    }

}

////////////////////////////
// AUTO GIT UPDATE FUNCTIONS 

/**
 * Creates a backup of the application, including node modules. 
 * The backup is stored in the configured tempLocation. Only one backup is kept at a time. 
 */
async function backupApp() {
    let destination = path.join(config.tempLocation, backupSubdirectory);
    log.detail('Auto Git Update - Backing up app to ' + destination);
    await fs.ensureDir(destination);
    await fs.copy(appRootPath.path, destination);
    return true;
}

/**
 * Downloads the update from the configured git repository.
 * The repo is cloned to the configured tempLocation. 
 */
async function downloadUpdate() {
    // Inject token for private repositories 
    let repo = config.repository;
    if (config.token) {
        repo = repo.replace('http://', '').replace('https://', '');
        repo = `https://${config.token}@${repo}`;
    }

    // Empty destination directory & clone repo
    let destination = path.join(config.tempLocation, cloneSubdirectory);
    log.detail('Auto Git Update - Cloning ' + repo);
    log.detail('Auto Git Update - Destination: ' + destination);
    await fs.ensureDir(destination);
    await fs.emptyDir(destination);
    await promiseClone(repo, destination);
    return true;
}

/**
 * Runs npm install to update/install application dependencies.
 */
function installDependencies() {
    return new Promise(function(resolve, reject) {
        //If testing is enabled, use alternative path to prevent overwrite of app. 
        let destination = testing ? path.join(appRootPath.path, '/testing/'): appRootPath.path;
        log.detail('Auto Git Update - Installing application dependencies in ' + destination);
        // Generate and execute command
        let command = `cd ${destination} && npm install`;
        let child = exec(command);

        // Wait for results
        child.stdout.on('end', resolve);
        child.stdout.on('data', data => log.general('Auto Git Update - npm install: ' + data.replace(/\r?\n|\r/g, '')));
        child.stderr.on('data', data => {
            if (data.toLowerCase().includes('error')) {
                // npm passes warnings as errors, only reject if "error" is included
                data = data.replace(/\r?\n|\r/g, '');
                log.error('Auto Git Update - Error installing dependencies');
                log.error('Auto Git Update - ' + data);
                reject();
            }else{
                log.warning('Auto Git Update - ' + data);
            }
        });
    });
}

/**
 * Purge ignored files from the update, copy the files to the app directory, and install new modules
 * The update is installed from  the configured tempLocation.
 */
async function installUpdate() {
    // Remove ignored files from the new version
    if (config.ignoreFiles) {
        log.detail('Auto Git Update - Purging ignored files from the update');
        config.ignoreFiles.forEach(file => {
            file = path.join(config.tempLocation, cloneSubdirectory, file);
            log.detail('Auto Git Update - Removing ' + file);
            fs.unlinkSync(file);
        });
    }

    // Install updated files
    let source = path.join(config.tempLocation, cloneSubdirectory);
    //If testing is enabled, use alternative path to prevent overwrite of app. 
    let destination = testing ? path.join(appRootPath.path, '/testing/'): appRootPath.path;
    log.detail('Auto Git Update - Installing update...');
    log.detail('Auto Git Update - Source: ' + source);
    log.detail('Auto Git Update - Destination: ' + destination);
    await fs.ensureDir(destination);
    await fs.copy(source, destination);
    return true;
}

/**
 * Reads the applications version from the package.json file.
 */
function readAppVersion() {
    let file = path.join(appRootPath.path, 'package.json');
    log.detail('Auto Git Update - Reading app version from ' + file);
    let appPackage = fs.readFileSync(file);
    return JSON.parse(appPackage).version;
}

/**
 * Reads the applications version from the git repository.
 */
async function readRemoteVersion() {
    // Generate request details
    let options = {}
    let url = config.repository + `/${config.branch}/package.json`;
    if (url.includes('github')) url = url.replace('github.com', 'raw.githubusercontent.com');
    if (config.token) options.headers = {Authorization: `token ${config.token}`}
    log.detail('Auto Git Update - Reading remote version from ' + url);
    // Send request for repositories raw package.json file
    try {
        let body = await promiseHttpsRequest(url, options);
        let remotePackage = JSON.parse(body);
        let version = remotePackage.version;
        return version;
    }catch(err) {
        if (err = 404) throw new Error('This repository requires a token or does not exist. \n ' + url);
        throw err;
    }
}

////////////////////////////
// HELPER & MISC FUNCTIONS 

/**
 * A promise wrapper for the simple-git clone function
 * @param {String} repo - The url of the repository to clone.
 * @param {String} destination - The local path to clone into. 
 */
function promiseClone(repo, destination) {
    return new Promise(function(resolve, reject) {
        git().clone(repo, destination, [], result => {
            if (result != null) reject(`Unable to clone repo \n ${repo} \n ${result}`);
            resolve();
        });
    });
}

/**
 * A promise wrapper for the child-process spawn function. Does not listen for results.
 * @param {String} command - The command to execute. 
 */
function promiseBlindExecute(command) {
    return new Promise(function(resolve, reject) {
        spawn(command, [], {shell: true, detached: true});
        setTimeout(resolve, 1000);
    });
}

/**
 * A promise wrapper for sending a get https requests.
 * @param {String} url - The Https address to request.
 * @param {String} options - The request options. 
 */
function promiseHttpsRequest(url, options) {
    return new Promise(function(resolve, reject) {
        let req = https.request(url, options, res => {
            //Construct response
            let body = '';
            res.on('data', data => {body += data});
            res.on('end', function() {
                if (res.statusCode == '200') return resolve(body);
                log.detail('Auto Git Update - Bad Response ' + res.statusCode);
                reject(res.statusCode);
            });
        });
        log.detail('Auto Git Update - Sending request to ' + url);
        log.detail('Auto Git Update - Options: ' + JSON.stringify(options));
        req.on('error', reject);
        req.end();
    }); 
}
