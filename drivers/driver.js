'use strict';

const Homey = require('homey');

class GeneralTasmotaDriver extends Homey.Driver {
	// methoids that should be implement:
	// 	pairingStarted - send command to start collect data
	// 	pairingFinished - process collected data
	#searchingDevices = false;
	#messagesCounter = 0;
	#messagesCollected = {};
	#topicsToIgnore = [];
	
    onInit()
    {
        this.debug = this.homey.app.debug;
        this.log(`${this.constructor.name} has been initiated`);
        this.MQTTClient = this.homey.api.getApiApp('nl.scanno.mqtt');
        this.topics = ["stat", "tele"];
        this.checkDevices = setInterval(() => {
            try {
                this.updateDevices();
            }
            catch (error) 
            { 
                if (this.debug) 
                    throw(error);
                else 
                    this.log(`${this.constructor.name} checkDevices error: ${error}`);
            }
        }, 30000);
        this.clientAvailable = false;
        this.MQTTClient
            .on('install', () => this.register())
            .on('uninstall', () => this.unregister())
            .on('realtime', (topic, message) => {
				if (this.#searchingDevices)
					this.collectPairingData(topic, message);
				this.onMessage(topic, message, this.#searchingDevices);
			});
        try {
            this.MQTTClient.getInstalled()
                .then(installed => {
                    this.clientAvailable = installed;
                    this.log(`MQTT client status: ${this.clientAvailable}`); 
                    if (installed) {
                        this.register();
                    }
                }).catch((error) => {
					this.log(`MQTT client app error: ${error}`);
				});
        }
        catch(error) {
            this.log(`MQTT client app error: ${error}`);
        };
        this.deviceConnectionTrigger = this.homey.flow.getTriggerCard('device_connection_changed');
    }
	
	collectPairingData(topic, message) {
		let topicParts = topic.split('/');
		this.#messagesCounter++;
		if ((topicParts[0] === 'stat') || (topicParts[1] === 'stat'))
		{
			let swapPrefixTopic = topicParts[1] === 'stat';
			let deviceTopic = swapPrefixTopic ? topicParts[0] : topicParts[1];
			if (!this.#topicsToIgnore.includes(deviceTopic))
			{
				if (!(deviceTopic in this.#messagesCollected))
					this.#messagesCollected[deviceTopic] = {
						swapPrefixTopic: swapPrefixTopic,
						messages: {}
					};
				for (const msgKey of Object.keys(message))
					this.#messagesCollected[deviceTopic].messages[msgKey] = message[msgKey];
			}
		}
	}
	
	getAllDevicesTopics() {
		let result = [];
		this.getDevices().forEach(device => {
            result.push(device.getMqttTopic());
        });
		return result;
	}
	
    updateDevices() {
        this.getDevices().forEach( device => {
            device.checkDeviceStatus();
        });
    }
	
    onDeviceStatusChange(device, newStatus, oldStatus) {
        if ((oldStatus === 'unavailable') && (newStatus === 'available'))
        {        
            this.deviceConnectionTrigger.trigger({name: device.getName(), device_id: device.getData().id, status: true}); 
        }
        else if ((oldStatus === 'available') && (newStatus === 'unavailable'))
        {
            this.deviceConnectionTrigger.trigger({name: device.getName(), device_id: device.getData().id, status: false}); 
        }
    }
	    
	subscribeTopic(topicName) {
        if (!this.clientAvailable)
            return;
        return this.MQTTClient.post('subscribe', { topic: topicName }, error => {
            if (error) {
                    this.log(`Can not subscrive to topic ${topicName}, error: ${error}`)
            } else {
                this.log(`Sucessfully subscribed to topic: ${topicName}`);
            }
        }).catch ( error => {
			if (!error.message.startsWith('invalid json response body at'))
				this.log(`Error while subscribing to ${topicName}. ${error}`);
        });
    }
	
	checkDeviceSearchStatus() {
        if ( this.checkDeviceSearchStatus.devicesCounter === undefined )
            this.checkDeviceSearchStatus.devicesCounter = 0;
        let devCount = Object.keys(this.#messagesCollected).length;
        if (devCount === this.checkDeviceSearchStatus.devicesCounter)
        {
            this.checkDeviceSearchStatus.devicesCounter = undefined;
            return true;
        }
        this.checkDeviceSearchStatus.devicesCounter = devCount;
        return false;
    }
	
	onPair( session ) {
        this.log(`onPair called`);
        var driver = this;
        var devices = {};
        session.setHandler('list_devices', async (data) => {
            if (devices.length === 0)
            {
                if (driver.#messagesCounter === 0)
                    return Promise.reject(new Error(driver.homey.__('mqtt_client.no_messages')));
                else
                    return Promise.reject(new Error(driver.homey.__('mqtt_client.no_new_devices')));
            }
            driver.log(`list_devices: New devices found: ${JSON.stringify(devices)}`);
            return devices;
        });
        session.setHandler('showView', async (viewId) => {
            driver.log(`onPair current phase: "${viewId}"`);
            if (viewId === 'loading')
            {
                if (!this.clientAvailable || !driver.pairingStarted())
				{
					this.#searchingDevices = false;
                    return Promise.reject(new Error(driver.homey.__('mqtt_client.unavailable')));
				}
				this.#messagesCounter = 0;
				this.#searchingDevices = true;
				this.#topicsToIgnore = this.getAllDevicesTopics();
				this.log(`Topics to ignore during pairing: ${JSON.stringify(this.#topicsToIgnore)}`);
				let interval = setInterval( ( drvArg, sessionArg ) => {
                    if (drvArg.checkDeviceSearchStatus())
                    {
                        clearInterval(interval);
						this.#searchingDevices = false;
                        devices = drvArg.pairingFinished(this.#messagesCollected);
						this.#messagesCollected = {};
                        sessionArg.emit('list_devices', devices, function(error, result) {
                            if (result) {
                                sessionArg.nextView()
                            } else {
                                    sessionArg.alert('Can not show devices list', null, function() {
                                    sessionArg.done()
                                });
                            }
                        });
                        sessionArg.nextView();
                    }
                }, 2000, driver, session);
            }
        });
    }

    sendMessage(topic, payload)
    {
        if (!this.clientAvailable)
            return;
            this.MQTTClient.post('send', {
                qos: 0,
                retain: false,
                mqttTopic: topic,
                mqttMessage: payload
           }).catch ( error => {
			if (!error.message.startsWith('invalid json response body at'))
				this.log(`Error while sending ${topic} <= "${payload}". ${error}`);
        });
    }
	
	onMessage(topic, message) {
        try {
            let topicParts = topic.split('/');
            let prefixFirst = this.topics.includes(topicParts[0]);
            if (prefixFirst || this.topics.includes(topicParts[1]))
            {
                let topicIndex = prefixFirst ? 1 : 0;
                let devices = this.getDevices();
                for (let index = 0; index < devices.length; index++)
                    if (devices[index].getMqttTopic() === topicParts[topicIndex])
                    {
                        devices[index].onMessage(topic, message);
                        break;
                    }
            }
        }
        catch (error) {
            if (this.debug) 
                throw(error);
            else 
                this.log(`onMessage error: ${error}`);
        }           
    }

    register() {
        this.clientAvailable = true;
        for  (let topic in this.topics)
        {
            this.subscribeTopic(this.topics[topic] + "/#");
            this.subscribeTopic("+/" + this.topics[topic] + "/#");
        }
        this.getDevices().forEach( device => {
            device.updateDevice();
        });
    }

    unregister() {
        this.clientAvailable = false;
        this.log(`${this.constructor.name} unregister called`);
    }
}

module.exports = GeneralTasmotaDriver;