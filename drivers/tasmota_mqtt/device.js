'use strict';

const Homey = require('homey');
const Sensor = require('./sensor.js')

class TasmotaDevice extends Homey.Device {

    async onInit() {
        this.log('Device init');
        this.log(`Name: ${this.getName()}`);
        this.log(`Class: ${this.getClass()}`);
        let settings = this.getSettings();
        this.log(`Setting: ${JSON.stringify(settings)}`);
		this.log(`Capabilities: ${JSON.stringify(this.getCapabilities())}`);
        this.driver = await this.getReadyDriver();
        this.relaysCount = parseInt(settings.relays_number);
        this.additionalSensors = (settings.additional_sensors !== '') || (settings.pwr_monitor === 'Yes');
        this.swap_prefix_topic = settings.swap_prefix_topic;
        this.shouldUpdateOnOff = false;
		this.shuttersNubmber = parseInt(settings.shutters_number);
        this.sockets = [];
		// Legacy devices conversion
        for (let i=1; i <= this.relaysCount; i++)
        {
            this.sockets.push(false);
            let capname = 'onoff.' + i.toString();
            if (this.hasCapability(capname))
                this.removeCapability(capname);
            capname = 'switch.' + i.toString();
            if (!this.hasCapability(capname))
            {
                this.addCapability(capname);
                this.setCapabilityOptions(capname, {title: { en: 'switch ' + i.toString() }});
            }
        };
        if (!this.hasCapability('onoff') && (this.relaysCount > 0))
            this.addCapability('onoff');
        let now = Date.now();
        this.update = {
            status: 'init',
            answerTimeout: undefined,
            nextRequest: now,
            updateInterval: settings.update_interval * 60 * 1000,
            timeoutInterval: 40 * 1000 
        };
        this.socketsList = [];
        for (let socketIndex=1; socketIndex <= this.relaysCount; socketIndex++)
            this.socketsList.push({name: 'socket '+socketIndex.toString()});
		this.invalidateStatus(Homey.__('device.unavailable.startup'));
        if (this.additionalSensors)
		{
			if (!this.hasCapability('additional_sensors'))
				this.addCapability('additional_sensors');
			this.sensorTrigger = new Homey.FlowCardTriggerDevice('sensor_value_changed').register();
		}
        this.onOffList = this.getCapabilities().filter( cap => cap.startsWith('switch.') );
        if (this.onOffList.length > 0)
        {
            this.registerMultipleCapabilityListener(this.onOffList, ( valueObj, optsObj ) => {
                let capName = Object.keys(valueObj)[0];
                let value = valueObj[capName] ? 'ON' : 'OFF';
                let index = capName.slice(-1);
                this.sockets[parseInt(index) - 1] = value
                this.sendTasmotaPowerCommand(index, value);
                return Promise.resolve();
            }, 500);
            this.registerCapabilityListener('onoff', ( value, opts ) => {
                // this.log(`onoff cap: ${JSON.stringify(value)}`);
                let message = value ? 'ON' : 'OFF';
                for (let itemIndex = 1; itemIndex <= this.relaysCount; itemIndex++)
                    this.sendTasmotaPowerCommand(itemIndex.toString(), message);
                return Promise.resolve();
            });
        }
        this.isDimmable = false;
        if (this.hasCapability('fan_speed'))
        {
            this.hasFan = true;
            this.registerCapabilityListener('fan_speed', ( value, opts ) => {
                // this.log(`fan_speed cap: ${JSON.stringify(value)}`);
                this.fanTrigger.trigger(this, {fan_speed: parseInt(value)}, value);
                this.sendMessage('FanSpeed', value);
                return Promise.resolve();
            });
            this.registerFanFlows();
        }
        else
            this.hasFan = false;
        if (this.hasCapability('multiplesockets'))
            this.registerMultipleSocketsFlows();
        else if (this.hasCapability('singlesocket'))
        {
            this.registerSingleSocketFlows();
            if (this.hasCapability('dim'))
            {
                this.isDimmable = true;
                this.registerCapabilityListener('dim', ( value, opts ) => {
                    //this.log(`dim cap: ${JSON.stringify(value)}`);
                    this.sendMessage('Dimmer', Math.round(value * 100).toString());
                    return Promise.resolve();
                });
                this.dimCondition1 = new Homey.FlowCardCondition('dim_level_greater');
                this.dimCondition1.register().registerRunListener((args, state) => {
                        return Promise.resolve(state.value * 100 > args.value);
                    });
                this.dimCondition2 = new Homey.FlowCardCondition('dim_level_lower');
                this.dimCondition2.register().registerRunListener((args, state) => {
                        return Promise.resolve(state.value * 100 < args.value);
                    });                            
            }
            if (this.hasCapability('light_temperature'))
            {
                this.hasLightTemperature = true;
                this.registerCapabilityListener('light_temperature', ( value, opts ) => {
                    // this.log(`light_temperature cap: ${JSON.stringify(value)}`);
                    this.sendMessage('CT', Math.round(153 + 347 * value).toString());
                    return Promise.resolve();
                });
            }
            if (this.hasCapability('light_hue') && this.hasCapability('light_saturation'))
            {
                this.hasLightColor = true;
                this.registerMultipleCapabilityListener(['light_hue', 'light_saturation'], ( valueObj, optsObj ) => {
                    let hueVal = valueObj['light_hue'];
                    if (hueVal === undefined)
                        hueVal = this.getCapabilityValue('light_hue');
                    let saturationVal = valueObj['light_saturation'];
                    if (saturationVal === undefined)
                        saturationVal = this.getCapabilityValue('light_saturation');     
                    let dimVal = this.hasCapability('dim') ? this.getCapabilityValue('dim') : 0.5;
                    this.sendMessage('HSBColor', Math.round(hueVal * 359).toString() + ',' + Math.round(saturationVal * 100).toString() + ',' + Math.round(dimVal * 100).toString() );
                    return Promise.resolve();
                }, 500);
            }
        }
		if (this.shuttersNubmber > 0)
		{
			this.registerShuttersCapListeners();
		}
		if (this.driver.clientAvailable)
			this.updateDevice();
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
        let updateTm = Date.now() + this.update.timeoutInterval;
        if ((this.update.answerTimeout == undefined) || (updateTm < this.update.answerTimeout)) 
            this.update.answerTimeout = updateTm;
    }
	
	updateDevice() {
		if (this.relaysCount > 0)
			this.sendMessage('Status', '11');	// StatusSTS
		if ((this.additionalSensors) || (this.shuttersNubmber > 0))
			this.sendMessage('Status', '10');  // StatusSNS
	}

    registerMultipleSocketsFlows() {
        this.socketTrigger = new Homey.FlowCardTriggerDevice('multiplesockets_relay_state_changed');
        this.socketTrigger.register().registerRunListener((args, state) => {
                return Promise.resolve(((args.socket_id.name === 'any socket') || (args.socket_id.name === state.socket_id.name)) &&
                                       ((args.state === 'state_any') || (args.state === state.state)));
            });
        this.socketTrigger.getArgument('socket_id').registerAutocompleteListener((query, args) => {
                return Promise.resolve([{name: 'any socket'}].concat(args.device.socketsList));
            });
        this.socketCondition = new Homey.FlowCardCondition('multiplesockets_switch_turned_on');
        this.socketCondition.register().registerRunListener((args, state) => {
                return Promise.resolve(args.device.getCapabilityValue('switch.'+args.socket_id.name.slice(-1)) === true);
            });
        this.socketCondition.getArgument('socket_id').registerAutocompleteListener((query, args) => {
                return Promise.resolve(args.device.socketsList);
            });
        this.socketConditionAll = new Homey.FlowCardCondition('multiplesockets_all_switches_turned_on'); 
        this.socketConditionAll.register().registerRunListener((args, state) => {
                for (let socketIndex=1;socketIndex<=args.device.relaysCount;socketIndex++)
                {
                    if (!args.device.getCapabilityValue('switch.'+socketIndex.toString()))
                        return Promise.resolve(false);
                }
                return Promise.resolve(true);
            });
        this.socketConditionAny = new Homey.FlowCardCondition('multiplesockets_some_switches_turned_on'); 
        this.socketConditionAny.register().registerRunListener((args, state) => {
                for (let socketIndex=1;socketIndex<=args.device.relaysCount;socketIndex++)
                {
                    if (args.device.getCapabilityValue('switch.'+socketIndex.toString()))
                        return Promise.resolve(true);
                }
                return Promise.resolve(false);
            });
        this.socketAction = new Homey.FlowCardAction('multiplesockets_switch_action');         
        this.socketAction.register().registerRunListener((args, state) => {
                let valueToSend;
                switch(args.state) {
                    case 'state_toggle':
                        valueToSend = 'TOGGLE';
                        break;
                    case 'state_on':
                        valueToSend = 'ON';
                        break;
                    case 'state_off':
                        valueToSend = 'OFF';
                        break;
                    default:
                        return Promise.resolve(false);                            
                }
                if (args.socket_id.name === 'all sockets')
                {   for (let socketIndex=1;socketIndex<=this.relaysCount;socketIndex++)
                        args.device.sendTasmotaPowerCommand(socketIndex.toString(),valueToSend); 
                    return Promise.resolve(true);
                }
                args.device.sendTasmotaPowerCommand(args.socket_id.name.slice(-1),valueToSend); 
                return Promise.resolve(true);
            });
        this.socketAction.getArgument('socket_id').registerAutocompleteListener((query, args) => {
                return Promise.resolve([{name: 'all sockets'}].concat(args.device.socketsList));
            });
    }
    
    registerFanFlows() {
        this.fanTrigger = new Homey.FlowCardTriggerDevice('fan_speed_changed');
        this.fanTrigger.register();
        this.fanCondition1 = new Homey.FlowCardCondition('fan_speed_greater');
        this.fanCondition1.register().registerRunListener((args, state) => {
                return Promise.resolve(parseInt(state.value) > args.value);
            });
        this.fanCondition2 = new Homey.FlowCardCondition('fan_speed_lower');
        this.fanCondition2.register().registerRunListener((args, state) => {
                return Promise.resolve(parseInt(state.value) < args.value);
            });                            
        this.fanAction = new Homey.FlowCardAction('fan_speed_action');         
        this.fanAction.register().registerRunListener((args, state) => {
                args.device.sendMessage('FanSpeed', args.value.toString());
                return Promise.resolve(true);
            });
    }
	
	registerShuttersCapListeners() {
		this.registerCapabilityListener('windowcoverings_state', ( value, opts ) => {
			// this.log(`windowcoverings_state cap: ${JSON.stringify(value)}`);
			try {
				switch (value) 
				{
					case "idle":
						this.sendMessage('ShutterPosition', 'STOP');
						break;
					case "up":
						this.sendMessage('ShutterPosition', 'UP');
						break;
					case "down":
						this.sendMessage('ShutterPosition', 'DOWN');
						break;
					default:
						throw new Error('unknown value');
						break;						
				};
			}
			catch (error) {
				this.log(`Error happened while processing capability "windowcoverings_state" value "${value}", error ${error}`);
			}
			return Promise.resolve();
		});
		this.registerCapabilityListener('windowcoverings_set', ( value, opts ) => {
			// this.log(`windowcoverings_set cap: ${JSON.stringify(value)}`);
			try {
				this.sendMessage('ShutterPosition', value * 100);
			}
			catch (error) {
				this.log(`Error happened while processing capability "windowcoverings_set" value "${value}", error ${error}`);
			}
			return Promise.resolve();
		});	
	}
	
    registerSingleSocketFlows() {
        this.socketTrigger = new Homey.FlowCardTriggerDevice('singlesocket_relay_state_changed');
        this.socketTrigger.register().registerRunListener((args, state) => {
                return Promise.resolve((args.state === 'state_any') || (args.state === state.state));
            })
        this.socketCondition = new Homey.FlowCardCondition('singlesocket_switch_turned_on');
        this.socketCondition.register().registerRunListener((args, state) => {
                return Promise.resolve(args.device.getCapabilityValue('switch.1') === true);
            });
        this.socketAction = new Homey.FlowCardAction('singlesocket_switch_action');         
        this.socketAction.register().registerRunListener((args, state) => {
                let valueToSend;
                switch(args.state) {
                    case 'state_toggle':
                        valueToSend = 'TOGGLE';
                        break;
                    case 'state_on':
                        valueToSend = 'ON';
                        break;
                    case 'state_off':
                        valueToSend = 'OFF';
                        break;
                    default:
                        return Promise.resolve(false);                            
                }
                args.device.sendTasmotaPowerCommand('1',valueToSend); 
                return Promise.resolve(true);
            });
    }

    setDeviceStatus(newStatus) {
        if (this.update.status !== newStatus)
        {
            let oldStatus = this.update.status;
            this.update.status = newStatus;
            this.driver.onDeviceStatusChange(this, newStatus, oldStatus);
        }
    }

    checkDeviceStatus() {
        let now = Date.now();
        if ((this.update.status === 'available') && (this.update.answerTimeout != undefined) && (now >= this.update.answerTimeout))
        {
            this.setDeviceStatus('unavailable');
            this.invalidateStatus(Homey.__('device.unavailable.timeout'));
        }
        if (now >= this.update.nextRequest)
        {
            this.update.nextRequest = now + this.update.updateInterval;
            this.sendMessage('Status', '11');  // StatusSTS
        }
    }

    invalidateStatus(message) {
        this.setUnavailable(message);
        this.sendMessage('Status', '11');  // StatusSTS
    }

    sendTasmotaPowerCommand(socketId, status) {
        let currentVal = this.getCapabilityValue('switch.' + socketId);
        if ((status === 'TOGGLE') ||
           ((status === 'ON') &&  !currentVal) ||
           ((status === 'OFF') && currentVal))
           {
                let topic = 'POWER'+socketId;
                // this.log(`Sending: ${topic} => ${status}`);
                this.sendMessage(topic, status);
           }
    }

    getReadyDriver() {
        return new Promise(resolve => {
            let driver = this.getDriver();
            driver.ready(() => resolve(driver));
        });
    }
    
    getMqttTopic() { 
        return this.getSettings()['mqtt_topic'];
    }

    onSettings(oldSettings, newSettings, changedKeysArr, callback) {
        if (changedKeysArr.includes('mqtt_topic') || changedKeysArr.includes('swap_prefix_topic'))
        {
            this.swap_prefix_topic = newSettings.swap_prefix_topic;
            setTimeout(() => {
                this.setDeviceStatus('init');
                this.invalidateStatus(Homey.__('device.unavailable.update'));
            }, 3000);
        }
        return callback(null, true);
    }

    calculateOnOffCapabilityValue() {
        let result = false;
        let switchCapNumber = this.onOffList.length;
        for (let itemIndex = 0; !result && (itemIndex < switchCapNumber); itemIndex++)
        {
            let capValue = this.getCapabilityValue(this.onOffList[itemIndex]);
            // this.log(`calculateOnOffCapabilityValue: ${this.onOffList[itemIndex]}=>${capValue}`);
            result = result || capValue;
        }                                             
        //this.log(`calculateOnOffCapabilityValue: result=>${result}`);
        return result;
    }

    powerReceived(topic, message) {
		if (!topic.startsWith('POWER'))
			return;
        //this.log(`powerReceived: ${topic}  => ${message}`);
        let capName = '';
        let socketIndex = '';
        if (topic === 'POWER')
        {
            capName = 'switch.1';
            socketIndex = '1';
        }
        else
        {
            socketIndex = topic.slice(-1);
            capName = 'switch.' + socketIndex;
        }
        let intIndex =  parseInt(socketIndex) - 1;
        if (intIndex > this.relaysCount)
            return;
        let oldVal = this.sockets[intIndex];
        let newState = message === 'ON';
        this.sockets[intIndex] = newState;
        if ((this.update.status === 'available') && (oldVal === newState))
            return;
        this.setCapabilityValue(capName, newState, () => 
            {
                // this.log(`Setting value ${capName}  => ${newState}`);
                if (!this.shouldUpdateOnOff)
                {
                    this.shouldUpdateOnOff = true;
                    setTimeout(() => {
                        this.shouldUpdateOnOff = false;
                        if (this.hasCapability('onoff'))
                        {
                            let newVal = this.calculateOnOffCapabilityValue();
                            //this.log(`onoff =>${newVal}`);
                            this.setCapabilityValue('onoff', newVal);
                        }
                    }, 500);
                }
            }                    
        );
		if (this.update.status === 'available')
		{
			let newSt = {};
			newSt['socket_id'] = {name: 'socket ' + socketIndex};
			newSt['state'] =  newState ? 'state_on' : 'state_off';
			this.socketTrigger.trigger(this, {socket_index: parseInt(socketIndex), socket_state: newState}, newSt);
			if (this.additionalSensors)
				setTimeout(() => {
					this.sendMessage('Status', '10');  // StatusSNS
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

    processMqttMessage(topic, message) {
        this.log(`processMqttMessage: ${topic} => ${JSON.stringify(message)}`);
        let topicParts = topic.split('/');
        if (topicParts.length != 3)
            return;
		try
		{
			let now = Date.now();
			if ((topicParts[2] === 'LWT') && (message === 'Offline'))
			{
				this.setDeviceStatus('unavailable');
				this.invalidateStatus(Homey.__('device.unavailable.offline'));
				this.update.nextRequest = now + this.update.updateInterval;
				return;
			}
			if (this.update.status === 'unavailable')
			{
				this.setDeviceStatus('available');
				this.setAvailable();
			}
			if (this.update.status === 'available')
			{
				this.update.nextRequest = now + this.update.updateInterval;
				this.update.answerTimeout = undefined;
			}
			let messageType = undefined;
			let root_topic = this.swap_prefix_topic ? topicParts[1] : topicParts[0];
			if (root_topic === 'tele')
			{
				if (topicParts[2] === 'STATE')
					messageType = 'StatusSTS';
				else if (topicParts[2] === 'SENSOR')
					messageType = 'StatusSNS';
			}
			else if (root_topic === 'stat')
			{
				if (topicParts[2].startsWith('STATUS'))
				{
					messageType = Object.keys(message)[0];
					if (messageType !== undefined)
						message = message[messageType];
				}
			}
			if ((messageType === undefined) && (topicParts[2] === 'RESULT'))
				messageType = 'Result'; 			
			if (messageType === undefined)
				return;
			if ((messageType === 'Result') || (messageType === 'StatusSTS'))
			{
				for (let valueKey in message)
				{
					let value = message[valueKey];
					switch (valueKey)
					{
						case 'FanSpeed':
							if (this.hasFan)
							{
								try
								{
									if (this.updateCapabilityValue('fan_speed', value.toString()))
										this.fanTrigger.trigger(this, {fan_speed: value}, {value: value});
								}
								catch (error)
								{
									this.log(`Error trying to set fan speed. Error: ${error}`);
								}									
							}
							break;
						case 'Dimmer':
							if (this.isDimmable)
							{
								try
								{
									let dimValue = value / 100;
									this.updateCapabilityValue('dim', dimValue);
								}
								catch (error)
								{
									this.log(`Error trying to set dim value. Error: ${error}`);
								}
							}
							break;
						case 'CT':	// Color temperature
							if (this.hasLightTemperature)
							{
								try
								{
									let ctValue = Math.round((value - 153) / 3.47) / 100;
									if (this.updateCapabilityValue('light_temperature', ctValue))
										this.updateCapabilityValue('light_mode', 'temperature');
								}
								catch (error)
								{
									this.log(`Error trying to set light temperature value. Error: ${error}`);
								}
							}
							break;
						case 'HSBColor':
							if (this.hasLightColor)
							{
								try
								{
									let values = value.split(',')
									if (values.length === 3)
									{
										let cCounter = 0;
										try
										{
											let hueValue = Math.round(parseInt(values[0], 10) / 3.59) / 100;
											if (this.updateCapabilityValue('light_hue', hueValue))
												cCounter++;
										}
										catch (error)
										{
											this.log('Error trying to set hue value. Error: ' + error);
										}
										try
										{
											let satValue = parseInt(values[1], 10) / 100;
											if (this.updateCapabilityValue('light_saturation', satValue))
												cCounter++;
										}
										catch (error)
										{
											this.log('Error trying to set saturation value. Error: ' + error);
										}
										if (cCounter > 0)
											this.updateCapabilityValue('light_mode', 'color');
									}
								}
								catch (error)
								{
									this.log(`Error trying to set light color value. Error: ${error}`);
								}
							}
							break;
						default:
							if (valueKey.startsWith('POWER') && (this.relaysCount > 0))
							{
								this.powerReceived(valueKey, value);
							}
							break;
					}
				}
				if ((this.relaysCount > 0) && (this.update.status !== 'available'))
				{
					this.setDeviceStatus('available');
					this.setAvailable();
				}				
			}
			if ((messageType === 'Result') || (messageType === 'StatusSNS'))
			{
				for (const sensor in message)
				{
					const snsObj = message[sensor];
					if (sensor.startsWith('Switch'))
					{
						let newValue = snsObj === 'ON';
						let capId = sensor.slice(-1);
						let capName = 'sensor_switch.' + capId;
						this.checkSensorCapability(capName, newValue, sensor, 'Switch');
					}
					else if (sensor === 'Shutter1')
					{
						if ((this.shuttersNubmber > 0) && (typeof snsObj === 'object') && (snsObj !== null))
						{
							if (snsObj['Direction'] !== undefined)
							{
								try {
									if (this.hasCapability('windowcoverings_state'))
									{
										const directionNum = parseInt(snsObj['Direction']);
										var direction = "idle";
										if (directionNum > 0)
											direction = "up";
										else if (directionNum < 0)
											direction = "down";
										let oldCap = this.getCapabilityValue('windowcoverings_state');
										this.setCapabilityValue('windowcoverings_state', direction);
									}
								}
								catch(error)
								{
									this.log(`While processing ${messageType}.${sensor}.Direction error happened: ${error}`); 
								}
							}
							if (snsObj['Position'] !== undefined)
							{
								try {
									if (this.hasCapability('windowcoverings_set'))
									{
										const positionNum = parseInt(snsObj['Position']);
										this.setCapabilityValue('windowcoverings_set', positionNum / 100);
									}
								}
								catch(error)
								{
									this.log(`While processing ${messageType}.${sensor}.Position error happened: ${error}`); 
								}
							}
							
						}
					}
					else
					{
						if ((typeof snsObj === 'object') && (snsObj !== null))
						{
							for (const snsField in snsObj)
							{
								if (snsField in Sensor.SensorsCapabilities)
								{
									let capName = Sensor.SensorsCapabilities[snsField].capability.replace('{sensor}', sensor);
									let newValue = snsObj[snsField];
									if (!this.hasCapability(capName))
									{
										if (sensor === 'ENERGY')
										{
											capName = Sensor.SensorsCapabilities[snsField].capability.replace('.{sensor}', '');
											if (!this.hasCapability(capName))
												capName = undefined;
										}
										else
											capName = undefined;
									}
									if (capName !== undefined)
									{
										this.checkSensorCapability(capName, newValue, sensor, snsField);
									}
								}
							}
						}
					}						
				}	
				if ((this.relaysCount == 0) && (this.update.status !== 'available'))
				{
					this.setDeviceStatus('available');
					this.setAvailable();
				}
			}
		}
		catch(error)
		{
			this.log(`processMqttMessage error: ${error}`); 
		}
    }
	
	checkSensorCapability(capName, newValue, sensorName, valueKind) {
		let oldValue = this.getCapabilityValue(capName);
		this.setCapabilityValue(capName, newValue);
		if (oldValue != newValue)
			this.sensorTrigger.trigger(this, {
					sensor_name: sensorName,
					sensor_value_kind: valueKind,
					sensor_value_new: newValue,
					sensor_value_old: oldValue
				}, newValue);
	}
}

module.exports = TasmotaDevice;