'use strict';

const Homey = require('homey');
const GeneralTasmotaDevice = require('../device.js');
const Sensor = require('../sensor.js');

class ZigbeeDevice extends GeneralTasmotaDevice {
    static additionalFields = ['BatteryPercentage', 'LinkQuality', 'LastSeen'];
    #shootDeviceStatusRequest = null;
    #sensorsCollected = [];
    
    async onInit() {
        this.device_id = this.getSettings().zigbee_device_id;
        super.onInit();
    }
    
    getDeviceId() {
        return this.device_id;
    }
    
    updateDevice() {
        this.sendMessage('ZbStatus3', this.getDeviceId());
    }
    
    checkSensorCapability(capName, newValue, sensorName, valueKind) {
        // this.log(`checkSensorCapability: ${sensorName}.${valueKind} => ${newValue}`); 
        let oldValue = this.getCapabilityValue(capName);
        this.setCapabilityValue(capName, newValue);
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
            if (typeof message === 'object')
            {
				let tmp_message = {};				
				tmp_message[this.getDeviceId()] = message;
				let m_message = {};
				m_message[this.getMqttTopic()] = tmp_message;
                Sensor.forEachSensorValue(m_message, (path, value) => {
                    let capObj = Sensor.getPropertyObjectForSensorField(path, 'zigbee', true);
                    let sensorField = path[path.length - 1];
                    let sensor = "";
                    if (path.length > 1)
                        sensor = path[path.length - 2];                 
                    if (capObj !== null) {
                        // Proper sensor value found
                        if (this.hasCapability(capObj.capability) && (value !== null) && (value !== undefined))
                        {
                            try {
                                let sensorFieldValue = capObj.value_converter != null ? capObj.value_converter(value) : value;
								this.log(`Updating sensor field: ${capObj.capability} <= ${sensorFieldValue}`);
                                this.checkSensorCapability(capObj.capability, sensorFieldValue, sensor, sensorField);
                            }
                            catch(error) {
                                if (this.debug) 
                                    throw(error);
                                else
                                    this.log(`While processing ${messageType}.${sensor}.${sensorField} error happened: ${error}`);
                            }
                        }
                    }
                }, this.debug);
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

module.exports = ZigbeeDevice;