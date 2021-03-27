'use strict';

const Homey = require('homey');
const GeneralTasmotaDevice = require('../device.js');

class ZigbeeBridgeDevice extends GeneralTasmotaDevice {

    async onInit() {
        super.onInit();
        this.setCapabilityValue('zigbee_pair', false);
        this.registerCapabilityListener('zigbee_pair', ( value, opts ) => {
                // this.log(`zigbee_pair cap: ${JSON.stringify(value)}`);
                // Trigger ???
                this.sendMessage('ZbPermitJoin', value ? '1' : '0');
                return Promise.resolve();
            });
    }

    updateDevice() {
        this.sendMessage('Status', '11');   // StatusSTS
    }
    
    processMqttMessage(topic, message) {
        let topicParts = topic.split('/');
        try
        {
            if (this.stage !== 'available')
            {
                this.setDeviceStatus('available');
                this.setAvailable();
            }               

            if (topicParts[2] === 'RESULT')
            {
                Object.keys(message).forEach( (key) => {
                    if ((key === 'ZbState') && ('Status' in message.ZbState))
                    {
                        let zbStateVal = message.ZbState.Status;
                        if ((zbStateVal == 21) || (zbStateVal == 22))
                            this.setCapabilityValue('zigbee_pair', true);
                        else if (zbStateVal == 20)
                            this.setCapabilityValue('zigbee_pair', false);
                    }
                });
            }
        }
        catch(error)
        {
            if (this.debug) 
                throw(error);
            else
                this.log(`processMqttMessage error: ${error}`); 
        }
    }
    

}

module.exports = ZigbeeBridgeDevice;