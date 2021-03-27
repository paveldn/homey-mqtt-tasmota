'use strict';

const Homey = require('homey');

class GeneralTasmotaDevice extends Homey.Device {
    // methoids that should be implement: 
    //  updateDevice
    //  processMqttMessage
    
    async onInit() {
        this.debug = this.homey.app.debug;
        this.log(`Device initialization. Name: ${this.getName()}, class ${this.getClass()}`);
        let settings = this.getSettings();
        this.log(`Setting: ${JSON.stringify(settings)}`);
        this.log(`Capabilities: ${JSON.stringify(this.getCapabilities())}`);
        if (!this.hasCapability('measure_signal_strength'))
            this.addCapability('measure_signal_strength');
		this.swap_prefix_topic = settings.swap_prefix_topic;
        this.stage = 'init';
        this.answerTimeout = undefined;
        this.nextRequest = Date.now();
        this.updateInterval = settings.update_interval * 60 * 1000;
        this.timeoutInterval = 40 * 1000;
        this.invalidateStatus(this.homey.__('device.unavailable.startup'));
    }

    getMqttTopic() { 
        return this.getSettings()['mqtt_topic'];
    }
    
    sendMqttCommand(command, content) {
        let topic = this.getMqttTopic();
        if (this.swap_prefix_topic)
            topic = topic + '/cmnd/' + command;
        else
            topic = 'cmnd/' + topic + '/' + command;
        // this.log(`Sending command: ${topic} => ${content}`);
        this.driver.sendMessage(topic, content);
    }

    sendMessage(topic, message) {
        this.sendMqttCommand(topic, message);
        let updateTm = Date.now() + this.timeoutInterval;
        if ((this.answerTimeout == undefined) || (updateTm < this.answerTimeout)) 
            this.answerTimeout = updateTm;
    }

    setDeviceStatus(newStatus) {
        if (this.stage !== newStatus)
        {
            let oldStatus = this.stage;
            this.stage = newStatus;
            this.driver.onDeviceStatusChange(this, newStatus, oldStatus);
        }
    }

    checkDeviceStatus() {
        let now = Date.now();
        if ((this.stage === 'available') && (this.answerTimeout != undefined) && (now >= this.answerTimeout))
        {
            this.setDeviceStatus('unavailable');
            this.invalidateStatus(this.homey.__('device.unavailable.timeout'));
        }
        if (now >= this.nextRequest)
        {
            this.nextRequest = now + this.updateInterval;
            this.updateDevice();
        }
    }

    invalidateStatus(message) {
        this.setUnavailable(message);
        this.updateDevice();
    }
    
    async onSettings(event) {
        if (event.changedKeys.includes('mqtt_topic') || event.changedKeys.includes('swap_prefix_topic'))
        {
            this.swap_prefix_topic = event.newSettings.swap_prefix_topic;
            setTimeout(() => {
                this.setDeviceStatus('init');
                this.nextRequest = Date.now();
                this.invalidateStatus(this.homey.__('device.unavailable.update'));
            }, 3000);
        }
    }

    updateCapabilityValue(cap, value) {
        if (this.hasCapability(cap))
        {
            let oldValue = this.getCapabilityValue(cap);
            this.setCapabilityValue(cap, value);
            return oldValue !== value;
        }
        return false;
    }
    
    getValueByPath(obj, path) {
        try {
            let currentObj = obj;
            let currentPathIndex = 0;
            while (currentPathIndex < path.length) {
                currentObj = currentObj[path[currentPathIndex]];
                currentPathIndex++;
            }
            return currentObj;
        }
        catch(error)
        {
            return undefined;
        }       
    }
    
    onMessage(topic, message, prefixFirst) {
        if (this.swap_prefix_topic === prefixFirst)
            return;
        this.log(`onMessage: ${topic} => ${JSON.stringify(message)}`);
        let topicParts = topic.split('/');
        if (topicParts.length != 3)
            return;
        try
        {
            let now = Date.now();
            if ((topicParts[2] === 'LWT') && (message === 'Offline'))
            {
                this.setDeviceStatus('unavailable');
                this.invalidateStatus(this.homey.__('device.unavailable.offline'));
                this.nextRequest = now + this.updateInterval;
                return;
            }
            if (this.stage === 'unavailable')
            {
                this.setDeviceStatus('available');
                this.setAvailable();
            }
            if (this.stage === 'available')
            {
                this.nextRequest = now + this.updateInterval;
                this.answerTimeout = undefined;
            }
            this.processMqttMessage(topic, message);
            if (this.hasCapability('measure_signal_strength'))
            {
                let signal = this.getValueByPath(message, ['StatusSTS', 'Wifi', 'RSSI']);
                if (signal && (typeof signal !== 'object'))
                {
                    signal = parseInt(signal)
                    if (!isNaN(signal))
						this.setCapabilityValue('measure_signal_strength', signal);
                }
            }
        }
        catch(error)
        {
            if (this.debug) 
                throw(error);
            else
                this.log(`onMessage error: ${error}`); 
        }
    }
    
}

module.exports = GeneralTasmotaDevice;