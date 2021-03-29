'use strict';

const Homey = require('homey');
const GeneralTasmotaDevice = require('../device.js');
const Sensor = require('../sensor.js');

class ZigbeeBridgeDevice extends GeneralTasmotaDevice {
	static baseCapabilities = ['zigbee_pair', 'measure_signal_strength', 'additional_sensors', 'button.drop_zigbee_devices', 'button.search_zigbee_devices'];
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
		this.searchDevices = 'no';
        this.setCapabilityValue('zigbee_pair', false);
        this.registerCapabilityListener('zigbee_pair', ( value, opts ) => {
                // this.log(`zigbee_pair cap: ${JSON.stringify(value)}`);
                // Trigger ???
                this.sendMessage('ZbPermitJoin', value ? '1' : '0');
                return Promise.resolve();
		});
		this.registerCapabilityListener('button.drop_zigbee_devices', async () => {
			throw new Error('Not implemented yet');
		});
		this.registerCapabilityListener('button.search_zigbee_devices', async () => {
			this.log(`Start searching for new supported devices`);
			this.#sensorsCollected = [];
			this.searchDevices = 'stage 1';
			this.sendMessage('ZbStatus1', '');
			return new Promise( (resolve, reject) => {
				setTimeout( () => {
					if (this.searchDevices === 'no')
						resolve(true);
					else {
						this.searchDevices = 'no';
						reject('Timeout!');
					}
				}, 10000);
			});
		});
		this.sensorTrigger = this.homey.flow.getDeviceTriggerCard('sensor_value_changed');
    }

    updateDevice() {
        this.sendMessage('Status', '11');   // StatusSTS
    }
    
	async updateCapabilitiesList(zbstatusCollected) {
		this.log(`Zigbee sensors discovered: ${JSON.stringify(zbstatusCollected)}`);
		for (let messageIndex in zbstatusCollected)
		{
			let message = zbstatusCollected[messageIndex];
			if (message && (typeof message === 'object'))
			{
				
				let deviceId = message.Device;
				if (deviceId)
				{
					let capCounter = 0;
					let name = message.Name;
					if (!name)
						name = deviceId
					let model = message.ModelId;
					if (!model)
						model = "unknown";
					else if (model in ZigbeeBridgeDevice.specialSensors)
						message = {...ZigbeeBridgeDevice.specialSensors[model].attributes, ...message};
					let msgObj = {'ZbReceived': {}};
					msgObj.ZbReceived[deviceId] = message;
					message = msgObj;	// Mimic to zbreceived message
					let supportedAttributes = {};
					Sensor.forEachSensorValue(message, (path, value) => {
						try {
							let field = path[path.length - 1];
							let capObj = Sensor.getPropertyObjectForSensorField(path, true, {'sensor': deviceId, 'name': name});
							if (capObj !== null)
							{
								supportedAttributes[field] = {
									'value': value,
									'capability': capObj,
									'path': path
								};
								if (!ZigbeeBridgeDevice.additionalFields.includes(field))
									capCounter++; 
							}
						}
						catch (error) {
						};
					});
					if (capCounter > 0)
					{
						this.log(`Sensor found: Id: ${deviceId} name: ${name} model: ${model} attributes: ${JSON.stringify(supportedAttributes)}`);
						for (let attrObjIndex in supportedAttributes)
						{
							let attrObj = supportedAttributes[attrObjIndex];
							let capName = attrObj.capability.capability;
							this.log(`Checking ${capName}`);
							if (!this.hasCapability(capName))
							{
								await this.addCapability(capName);
								let units = attrObj.capability.units.units_template.replace('{value}', attrObj.capability.units.default);
								this.setCapabilityOptions(capName, {title: { en:  attrObj.capability.caption }, units:{ en:  units } });
								let sensorFieldValue = attrObj.capability.value_converter != null ? attrObj.capability.value_converter(attrObj.value) : attrObj.value;
								this.setCapabilityValue(capName, sensorFieldValue);
							}
						};
					}
				}
			}
		};
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
            if ((this.searchDevices === 'no') && (this.stage !== 'available'))
            {
                this.setDeviceStatus('available');
                this.setAvailable();
            }
			if ((this.searchDevices === 'stage 1') && (typeof message === 'object') && ('ZbStatus1' in message))
			{
				let devices = message.ZbStatus1;
				if (devices.length === 0)
					this.searchDevices === 'no'
				else
				{
					this.searchDevices = 'stage 2';
					this.log(`Devices found: ${JSON.stringify(devices)}`);
					let shootDeviceStatusRequest = null;
					this.#shootDeviceStatusRequest = setInterval((devicesQueue) => {
						if (devicesQueue.length > 0)
						{
							let dev = devicesQueue[0];
							devicesQueue.shift();
							this.sendMessage('ZbStatus3', dev.Device); 
						}
						else
						{
							clearInterval(this.#shootDeviceStatusRequest);
							setTimeout( () => {
								this.log(`sensor dtata collection finished!`);
								this.searchDevices = 'no';
								this.updateCapabilitiesList(this.#sensorsCollected);
							},3000);
						}
					}, 500, devices);
				}
			}
			if ((this.searchDevices === 'stage 2') && (typeof message === 'object') && ('ZbStatus3' in message))
			{
				let content = message.ZbStatus3;
				if (Array.isArray(content))
					this.#sensorsCollected = this.#sensorsCollected.concat(content);
				else
					this.#sensorsCollected.push(message.ZbStatus3);
			}
			if ((topicParts[2] === 'SENSOR') && (typeof message === 'object') && ('ZbReceived' in message))
			{
				Sensor.forEachSensorValue(message, (path, value) => {
                    let capObj = Sensor.getPropertyObjectForSensorField(path, true);
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