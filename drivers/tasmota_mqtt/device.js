'use strict';

const Homey = require('homey');
const Sensor = require('../sensor.js');
const GeneralTasmotaDevice = require('../device.js');

class TasmotaDevice extends GeneralTasmotaDevice {

    async onInit() {
        super.onInit();
        let settings = this.getSettings();
        this.relaysCount = parseInt(settings.relays_number);
        this.additionalSensors = (settings.additional_sensors !== '') || (settings.pwr_monitor === 'Yes');
        this.shouldUpdateOnOff = false;
        this.shuttersNubmber = parseInt(settings.shutters_number);
        this.sockets = [];
        this.socketsList = [];
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

        for (let socketIndex=1; socketIndex <= this.relaysCount; socketIndex++)
            this.socketsList.push({name: 'socket '+socketIndex.toString()});
        if (this.additionalSensors)
        {
            if (!this.hasCapability('additional_sensors'))
                this.addCapability('additional_sensors');
            this.sensorTrigger = this.homey.flow.getDeviceTriggerCard('sensor_value_changed')
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
                this.homey.flow.getDeviceTriggerCard('fan_speed_changed').trigger(this, {fan_speed: parseInt(value)}, value);
                this.sendMessage('FanSpeed', value);
                return Promise.resolve();
            });
        }
        else
            this.hasFan = false;
        if (this.hasCapability('singlesocket'))
        {
            if (this.hasCapability('dim'))
            {
                this.isDimmable = true;
                this.registerCapabilityListener('dim', ( value, opts ) => {
                    //this.log(`dim cap: ${JSON.stringify(value)}`);
                    this.sendMessage('Dimmer', Math.round(value * 100).toString());
                    return Promise.resolve();
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
        if (this.hasCapability('zigbee_pair'))
        {
            this.setCapabilityValue('zigbee_pair', false);
            this.registerCapabilityListener('zigbee_pair', ( value, opts ) => {
                // this.log(`zigbee_pair cap: ${JSON.stringify(value)}`);
                this.homey.flow.getDeviceTriggerCard('zigbee_pair_changed').trigger(this, {value: value}, null);
                this.sendMessage('ZbPermitJoin', value ? '1' : '0');
                return Promise.resolve();
            });

        }
        if (this.shuttersNubmber > 0)
        {
            this.registerShuttersCapListeners();
        }
    }
    
    updateDevice() {
        this.sendMessage('Status', '11');   // StatusSTS
        if ((this.additionalSensors) || (this.shuttersNubmber > 0))
            this.sendMessage('Status', '10');  // StatusSNS
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
                if (this.debug)
                    throw(error);
                else
                    this.log(`Error happened while processing capability "windowcoverings_state" value "${value}", error ${error}`);
            }
            return Promise.resolve();
        });
        this.registerCapabilityListener('windowcoverings_set', ( value, opts ) => {
            //this.log(`windowcoverings_set cap: ${JSON.stringify(value)}`);
            try {
                
                this.sendMessage('ShutterPosition', (value * 100).toString());
            }
            catch (error) {
                if (this.debug)
                    throw(error);
                else
                    this.log(`Error happened while processing capability "windowcoverings_set" value "${value}", error ${error}`);
            }
            return Promise.resolve();
        }); 
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
        this.log(`powerReceived: ${topic}  => ${message}`);
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
        if ((this.stage === 'available') && (oldVal === newState))
            return;
        this.setCapabilityValue(capName, newState).then( () => 
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
            });
        if (this.stage === 'available')
        {
            let newSt = {};
            newSt['socket_id'] = {name: 'socket ' + socketIndex};
            newSt['state'] =  newState ? 'state_on' : 'state_off';
            this.homey.flow.getDeviceTriggerCard('multiplesockets_relay_state_changed').trigger(this, {socket_index: parseInt(socketIndex), socket_state: newState}, newSt);
            if (this.additionalSensors)
                setTimeout(() => {
                    this.sendMessage('Status', '10');  // StatusSNS
                }, 3000);
        }
    }
    
    processMqttMessage(topic, message) {
        let topicParts = topic.split('/');
        try
        {
            if (this.stage === 'unavailable')
            {
                this.setDeviceStatus('available');
                this.setAvailable();
            }
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
                                        this.homey.flow.getDeviceTriggerCard('fan_speed_changed').trigger(this, {fan_speed: parseInt(value)}, value);
                                }
                                catch (error)
                                {
                                    if (this.debug)
                                        throw(error);
                                    else
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
                                    if (this.debug)
                                        throw(error);
                                    else
                                        this.log(`Error trying to set dim value. Error: ${error}`);
                                }
                            }
                            break;
                        case 'CT':  // Color temperature
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
                                    if (this.debug) 
                                        throw(error);
                                    else
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
                                            if (this.debug) 
                                                throw(error);
                                            else
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
                                            if (this.debug) 
                                                throw(error);
                                            else
                                                this.log('Error trying to set saturation value. Error: ' + error);
                                        }
                                        if (cCounter > 0)
                                            this.updateCapabilityValue('light_mode', 'color');
                                    }
                                }
                                catch (error)
                                {
                                    if (this.debug) 
                                        throw(error);
                                    else
                                        this.log(`Error trying to set light color value. Error: ${error}`);
                                }
                            }
                            break;
                        case 'ZbState':
                            if (this.hasCapability('zigbee_pair') && (typeof value === 'object' ) && ('Status' in value))
                            {
                                let zbStateVal = undefined;
                                switch (value.Status)
                                {
                                    case 21:
                                    case 22:
                                        zbStateVal = true;
                                        break;
                                    case 20:
                                        zbStateVal = false;
                                        break;
                                }
                                if (zbStateVal !== undefined)
                                {
                                    if (this.updateCapabilityValue('zigbee_pair', zbStateVal))
                                    {
                                         this.homey.flow.getDeviceTriggerCard('zigbee_pair_changed').trigger(this, {value: zbStateVal}, null);
                                    }
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
                if ((this.relaysCount > 0) && (this.stage !== 'available'))
                {
                    this.setDeviceStatus('available');
                    this.setAvailable();
                }               
            }
            if ((messageType === 'Result') || (messageType === 'StatusSNS'))
            {
                Sensor.forEachSensorValue(message, (path, value) => {
                    let capObj = Sensor.getPropertyObjectForSensorField(path, 'wired', true);
                    // this.log(`Sensor status: ${JSON.stringify(path)} => ${capObj ? JSON.stringify(capObj) : 'none'}`);
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
                    else {
                        // Special cases
                        if ((sensor === 'Shutter1') && (this.shuttersNubmber > 0) && (value != null) && (value !== 'null'))
                        {
                            // Only Shutter1 is supported
                            try {
                                switch (sensorField)
                                {
                                    case 'Direction':
                                        if (this.hasCapability('windowcoverings_state'))
                                        {
                                            const directionNum = parseInt(value);
                                            var direction = "idle";
                                            if (directionNum > 0)
                                                direction = "up";
                                            else if (directionNum < 0)
                                                direction = "down";
                                            this.setCapabilityValue('windowcoverings_state', direction);
                                        }                           
                                        break;
                                    case 'Position':
                                        if (this.hasCapability('windowcoverings_set'))
                                        {
                                            const positionNum = parseInt(value);
                                            this.setCapabilityValue('windowcoverings_set', positionNum / 100);
                                        }
                                        break;
                                }
                            }
                            catch(error)
                            {
                                if (this.debug) 
                                    throw(error);
                                else 
                                    this.log(`While processing ${messageType}.${sensor}.${sensorField} error happened: ${error}`);
                            }
                        }
                    }
                }, this.debug);
                if ((this.relaysCount == 0) && (this.stage !== 'available'))
                {
                    this.setDeviceStatus('available');
                    this.setAvailable();
                }
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
            return true;
        }
        return false;
    }
}

module.exports = TasmotaDevice;