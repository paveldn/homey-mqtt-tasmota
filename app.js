'use strict';

const Homey = require('homey');
var fs = require('fs');
var https  = require('https');

const latestTasmotaReleaseFilename = '../userdata/tasmota.ver';


class TasmotaMqttApp extends Homey.App {
    makeHttpsRequest(options, timeout) {
        return new Promise((resolve, reject) => {
            const request = https.request(options, (res) => {
                let resBody = '';
                res.on('data', (chunk) => {
                    resBody += chunk;
                });
                res.once('end', () => {
                    res.body = resBody;
                    return resolve(res); // resolve the request
                });
            });
            request.setTimeout(timeout || this.timeout, () => {
                request.abort();
            });
            request.once('error', (e) => {
                this.lastResponse = e;  // e.g. ECONNREFUSED on wrong port or wrong IP // ECONNRESET on wrong IP
                return reject(e);
            });
            request.end();
        });
    }
    
    parseVersionString(vstring)
    {
        const match = vstring.match(/^v(?<major>\d+)\.(?<minor>\d+)\.(?<revision>\d+)$/);
        if (match === null)
            return null;
        return { major: match.groups.major, minor: match.groups.minor, revision: match.groups.revision }
    }
    
    async getLatestTasmotaVersion()
    {
        try
        {
            const result = await this.makeHttpsRequest({
                host: 'api.github.com',
                path: '/repos/arendst/tasmota/releases/latest',
                method: 'GET',
                headers: {
                    'user-agent': 'node.js'
                }}, 2000);
            if (result.statusCode !== 200) 
                throw new Error(`Error while checking tasmota releases, staus: ${result.statusCode}`);
            const info = JSON.parse(result.body);
            const version = this.parseVersionString(info.tag_name);
            if (version !== null)
                this.log(`getLatestTasmotaVersion: Version: ${version.major}.${version.minor}.${version.revision}`);
            return version;
        }
        catch(error)
        {
            this.log(error);
            return null;
        }
    }
    
    saveTasmotaVersion(version)
    {
        try
        {
            fs.writeFileSync(latestTasmotaReleaseFilename, `v${version.major}.${version.minor}.${version.revision}`, { encoding: 'utf8' });
        }
        catch (error)
        {
            this.log('Error writing tasmota version file: ' + error);
            return;
        }
    }
    
    loadTasmotaVersion()
    {
        try
        {
            if (!fs.existsSync(latestTasmotaReleaseFilename))
            {
                this.log('loadTasmotaVersion: No version file exists!');
                return null;
            }
            var tempStr = fs.readFileSync( latestTasmotaReleaseFilename, { encoding: 'utf8' });
            return this.parseVersionString(tempStr);
        }
        catch (error)
        {
            return null;
        }
    }
    
    async checkTasmotaReleases()
    {
        try
        {
            let newVersion = await this.getLatestTasmotaVersion();
            if (newVersion !== null)
            {
                let saveVersion = false;
                if (this.lastTasmotaVersion === null)
                {
                    this.log(`Latest Tasmota release detected ${newVersion.major}.${newVersion.minor}.${newVersion.revision} (no saved version found)`);
                    saveVersion = true;
                }
                else
                {
                    let updateAvailable =   (this.lastTasmotaVersion.major <   newVersion.major) ||
                                            (this.lastTasmotaVersion.major === newVersion.major) && (this.lastTasmotaVersion.minor <   newVersion.minor) ||
                                            (this.lastTasmotaVersion.major === newVersion.major) && (this.lastTasmotaVersion.minor === newVersion.minor) && (this.lastTasmotaVersion.revision < newVersion.revision);
                    if (updateAvailable)
                    {
                        this.tasmotaUpdateTrigger.trigger(  {
                                                                new_major:      newVersion.major,
                                                                new_minor:      newVersion.minor,
                                                                new_revision:   newVersion.revision,
                                                                old_major:      this.lastTasmotaVersion.major,
                                                                old_minor:      this.lastTasmotaVersion.minor,
                                                                old_revision:   this.lastTasmotaVersion.revision
                                                            });
                        saveVersion = true;
                        this.log(`New Tasmota version available ${newVersion.major}.${newVersion.minor}.${newVersion.revision} (old ${this.lastTasmotaVersion.major}.${this.lastTasmotaVersion.minor}.${this.lastTasmotaVersion.revision})`);
                    }
                }
                if (saveVersion)
                {
                    this.saveTasmotaVersion(newVersion);
                    this.lastTasmotaVersion = newVersion;
                }
            }
        }
        catch(error)
        {
            this.log(`checkTasmotaReleases: ${error}`);
        }
    }
    
    onInit() {
		try {
			let manifest = JSON.parse(fs.readFileSync('./app.json', 'utf8'));
			this.applicationVersion = manifest.version;
			this.debug = process.env.DEBUG == 1;
			this.applicationName = manifest.name.en;
		}
		catch (error)
		{
			this.applicationVersion = undefined;
			this.debug = false;
			this.applicationName = this.constructor.name;
		}
        this.log(`${this.applicationName} is running. Version: ${this.applicationVersion}, debug: ${this.debug}`);
        this.lastTasmotaVersion = this.loadTasmotaVersion();
        this.tasmotaUpdateTrigger = new Homey.FlowCardTrigger('new_tasmota_version').register();
        setTimeout(() => {
                this.checkTasmotaReleases();
                setInterval(() => {
                        this.checkTasmotaReleases();
                    }, 86400000); // Check for new tasmota releases once per day
            }, 300000);
    }
    
}

module.exports = TasmotaMqttApp;