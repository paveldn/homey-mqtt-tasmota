'use strict';

const Homey = require('homey');
const GeneralTasmotaDevice = require('../device.js');
const Sensor = require('../sensor.js');

class ZigbeeDevice extends GeneralTasmotaDevice {
    static specialSensors = {
        'lumi.sensor_wleak.aq1' : {
            'attributes': {'0500<00': "000000FF0000"} // "010000FF0000" - on / "000000FF0000" - off
        }           
    };
    static additionalFields = ['BatteryPercentage', 'LinkQuality'];
    #shootDeviceStatusRequest = null;
    #sensorsCollected = [];
    
    async onInit() {
        super.onInit();
		this.device_id = this.getSettings().zigbee_device_id;
		this.updateDevice();
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
        if (oldValue != newValue)
        {
            if (typeof oldValue === "boolean")
                oldValue = oldValue ? 1 : 0;
            if (typeof newValue === "boolean")
                newValue = newValue ? 1 : 0;
            this.sensorTrigger.trigger(this, {
                    sensor_name: sensorName,
                    sensor_value_kind: valueKind,
                    sensor_value_new: newValue,
                    sensor_value_old: oldValue
                }, newValue);
        }
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
                Sensor.forEachSensorValue(message, (path, value) => {
                    let capObj = Sensor.getPropertyObjectForSensorField(path, 'zigbee', false);
                    this.log(`Sensor status: ${JSON.stringify(path)} => ${capObj ? JSON.stringify(capObj) : 'none'}`);
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

module.exports = ZigbeeDevice;