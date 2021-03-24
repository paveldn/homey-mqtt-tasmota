'use strict';

const Homey = require('homey');
const GeneralTasmotaDevice = require('../device.js');

class ZigbeeBridgeDevice extends GeneralTasmotaDevice {

    async onInit() {
        this.debug = this.homey.app.debug;
        this.log(`Device init, debug=${this.debug}`);
        this.log(`Name: ${this.getName()}`);
        this.log(`Class: ${this.getClass()}`);
        let settings = this.getSettings();
        this.log(`Setting: ${JSON.stringify(settings)}`);
        this.log(`Capabilities: ${JSON.stringify(this.getCapabilities())}`);
    }

    updateDevice() {
		this.sendMessage('Status', '11');   // StatusSTS
    }
    
    processMqttMessage(topic, message) {
        this.log(`processMqttMessage: ${topic} => ${JSON.stringify(message)}`);
    }
    

}

module.exports = ZigbeeBridgeDevice;