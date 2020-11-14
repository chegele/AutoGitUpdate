
# Auto Git Update
a node.js module used for automatically updating projects from a git repository. 

### Notes
 - This module comes in two flavors. ECMAScript & Commonjs.
 - The default install will be an ECMAScript module which requires use of an import statement. 
 - __Optionally, install the commonjs module to make use of the more popular require statement.__
 - This module uses simple-logger (https://github.com/chegele/Logger).
 - To update from private repositories a personal access token needs to be provided. 
 - During updates a backup of the old version is taken and stored in the configured tempLocation.
 - The remote package.json is compared to the local package.json to determine if a different version is available. 

### Options
 - **repository** *String* - The url to the root of a git repository to update from.
 - **tempLocation** *String* - The local dir to save temporary information for Auto Git Update.
 - **branch** *String* - [optional] The branch to update from. Defaults to master.
 - **token** *String* - [optional] A personal access token used for accessions private repositories. 
 - **ignoreFiles** *Array[String]* - [optional] An array of files to not install when updating. Useful for config files. 
 - **executeOnComplete** *String* - [optional] A command to execute after an update completes. Good for restarting the app.
 - **exitOnComplete** *Boolean* - [optional] Use process exit to stop the app after a successful update.

### Functions
 - **autoUpdate()** - Updates if local package.json version is different than remote.
 - **compareVersions()** - Compares package.json versions without updating.
   - Returns an object with the properties *UpToDate*, *currentVersion*, & *remoteVersion*.
 - **forceUpdate()** - Updates without comparing package versions.
 - **setLogConfig(logConfig)** - Updates logging configuration. https://github.com/chegele/Logger

### ECMAScript Example (default)
```
npm i auto-git-update
```
```
import AutoGitUpdate from 'auto-git-update';

const config = {
    repository: 'https://github.com/chegele/BackupPurger'
    tempLocation: 'C:/Users/scheg/Desktop/tmp/',
    ignoreFiles: ['util/config.js'],
    executeOnComplete: 'C:\\Users\\scheg\\Desktop\\worksapce\\AutoGitUpdate\\startTest.bat',
    exitOnComplete: true
}

const updater = new AutoGitUpdate(config);

updater.autoUpdate();
```

### CommonJS Example
```
npm i auto-git-update@commonjs
```
```
const AutoGitUpdate = require('auto-git-update');

const config = {
    repository: 'https://github.com/chegele/BackupPurger'
    tempLocation: 'C:/Users/scheg/Desktop/tmp/',
    ignoreFiles: ['util/config.js'],
    executeOnComplete: 'C:\\Users\\scheg\\Desktop\\worksapce\\AutoGitUpdate\\startTest.bat',
    exitOnComplete: true
}

const updater = new AutoGitUpdate(config);

updater.autoUpdate();
```