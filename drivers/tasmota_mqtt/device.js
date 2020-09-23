'use strict';

const Homey = require('homey');
const PowerMeterCapabilities = require('./power')

class TasmotaDevice extends Homey.Device {

    async onInit() {
        this.log('Device init');
        this.log('Name:', this.getName());
        this.log('Class:', this.getClass());
        let settings = this.getSettings();
        this.log('Setting: ' + JSON.stringify(settings));
        this.driver = await this.getReadyDriver();
        this.relaysCount = parseInt(settings.relays_number);
        this.powerMonitoring = settings.pwr_monitor === 'Yes';
        this.swap_prefix_topic = settings.swap_prefix_topic;
        this.shouldUpdateOnOff = false;
        this.sockets = [];
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
        if (!this.hasCapability('onoff'))
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
        if (this.powerMonitoring)
            this.sendMessage('Status', '10');  // StatusSNS
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
                // this.log('onoff cap: ' + JSON.stringify(value));
                let message = value ? 'ON' : 'OFF';
                for (let itemIndex = 1; itemIndex <= this.relaysCount; itemIndex++)
                    this.sendTasmotaPowerCommand(itemIndex.toString(), message);
                return Promise.resolve();
            });
        }
        this.isDimmable = false;
        let needToSendStatus11 = false;
        if (this.hasCapability('fan_speed'))
        {
            this.hasFan = true;
            needToSendStatus11 = true;
            this.registerCapabilityListener('fan_speed', ( value, opts ) => {
                this.log('fan_speed cap: ' + JSON.stringify(value));
                this.sendMessage('FanSpeed', value);
                return Promise.resolve();
            });
        }
        else
            this.hasFan = false;
        if (this.hasCapability('multiplesockets'))
            this.registerMultipleSocketsFlows();
        else
        {
            this.registerSingleSocketFlows();
            if (this.hasCapability('dim'))
            {
                this.isDimmable = true;
                needToSendStatus11 = true;
                this.registerCapabilityListener('dim', ( value, opts ) => {
                    //this.log('dim cap: ' + JSON.stringify(value));
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
                needToSendStatus11 = true;
                this.registerCapabilityListener('light_temperature', ( value, opts ) => {
                    // this.log('light_temperature cap: ' + JSON.stringify(value));
                    this.sendMessage('CT', Math.round(153 + 347 * value).toString());
                    return Promise.resolve();
                });
            }
            if (this.hasCapability('light_hue') && this.hasCapability('light_saturation'))
            {
                this.hasLightColor = true;
                needToSendStatus11 = true;
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
        if (needToSendStatus11)
            this.sendMessage('Status', '11');
    }

    sendMqttCommand(command, content) {
        let topic = this.getMqttTopic();
        if (this.swap_prefix_topic)
            topic = topic + '/cmnd/' + command;
        else
            topic = 'cmnd/' + topic + '/' + command;
        // this.log('Sending command: ' + topic + ' => ' + content);
        this.driver.sendMessage(topic, content);
    }

    sendMessage(topic, message) {
        this.sendMqttCommand(topic, message);
        let updateTm = Date.now() + this.update.timeoutInterval;
        if ((this.update.answerTimeout == undefined) || (updateTm < this.update.answerTimeout)) 
            this.update.answerTimeout = updateTm;
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
                // this.log('Sending: ' + topic + ' => ' + status);
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
        for (var itemIndex = 0; !result && (itemIndex < switchCapNumber); itemIndex++)
        {
            let capValue = this.getCapabilityValue(this.onOffList[itemIndex]);
            //this.log('calculateOnOffCapabilityValue: ' +  this.onOffList[itemIndex] + '=>' + capValue);
            result = result || capValue;
        }                                             
        //this.log('calculateOnOffCapabilityValue: result=>' + result);
        return result;
    }

    powerReceived(topic, message) {
        this.log('powerReceived: ' + topic + ' => ' + message);
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
        // this.log('Old val = ' + oldVal); 
        if (oldVal === newState)
            return;
        this.setCapabilityValue(capName, newState, () => 
            {
                // this.log('Setting value ' + capName + ' => ' + newState);
                if (!this.shouldUpdateOnOff)
                {
                    this.shouldUpdateOnOff = true;
                    setTimeout(() => {
                        this.shouldUpdateOnOff = false;
                        let newVal = this.calculateOnOffCapabilityValue();
                        // this.log('onoff =>' + newVal);
                        this.setCapabilityValue('onoff', newVal);
                    }, 500);
                }
            }                    
        );
        let newSt = {};
        newSt['socket_id'] = {name: 'socket ' + socketIndex};
        newSt['state'] =  newState ? 'state_on' : 'state_off';
        this.socketTrigger.trigger(this, {socket_index: parseInt(socketIndex), socket_state: newState}, newSt);
        if (this.powerMonitoring)
            setTimeout(() => {
                this.sendMessage('Status', '10');  // StatusSNS
            }, 3000);
    }

    updateCapabilityValue(cap, value) {
        if (this.hasCapability(cap))
        {
            let oldValue = this.getCapabilityValue(cap);
            if (oldValue !== value)
            {
                // this.log('Set value ' + cap +': ' + oldValue + ' => ' + value);
                this.setCapabilityValue(cap, value);
                return true;
            }
        }
        return false;
    }

    processMqttMessage(topic, message) {
        this.log('processMqttMessage: ' + topic + '=>' + JSON.stringify(message));
        let topicParts = topic.split('/');
        if (topicParts.length != 3)
            return;
        let now = Date.now();
        if ((topicParts[2] === 'LWT') && (message === 'Offline'))
        {
            this.setDeviceStatus('unavailable');
            this.invalidateStatus(Homey.__('device.unavailable.offline'));
            this.update.nextRequest = now + this.update.updateInterval;
            return;
        }
        if (this.update.status === 'init')
        {
            if (topicParts[2] === 'STATUS11')
            {                                  
                const status = Object.values(message)[0];
                let check = 0;
                let onoffValue = false;
                for (let i=0; i < this.relaysCount; i++)
                {
                    let bValue = false;
                    if ((i == 0) && (status['POWER'] !== undefined))
                    {
                        bValue = status['POWER'] === 'ON';
                        let capName = 'switch.1';
                        this.setCapabilityValue(capName, bValue);
                        check++;
                        this.sockets[0] = bValue;
                    }
                    else if (status['POWER'+(i+1).toString()] !== undefined)
                    {
                        bValue = status['POWER'+(i+1).toString()] === 'ON';
                        let capName = 'switch.'+(i+1).toString();
                        this.setCapabilityValue(capName, bValue);
                        check++;
                        this.sockets[i] = bValue;
                    }
                    onoffValue = onoffValue || bValue;
                }
                this.setCapabilityValue('onoff', onoffValue);
                if (check === this.relaysCount)
                {
                    this.setDeviceStatus('available');
                    this.setAvailable();
                }
            }
            else
                this.update.nextRequest = now;
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
        if (topicParts[2].startsWith('POWER'))
        {
            this.powerReceived(topicParts[2], message);
        }
        if ((topicParts[2] === 'RESULT') || (topicParts[2] === 'STATE'))
        {
            let updateOnOff = false;
            Object.keys(message).forEach(key => {
                if ((key === 'Dimmer') && this.isDimmable)
                {
                    try
                    {
                        let dimValue = message['Dimmer'] / 100;
                        this.updateCapabilityValue('dim', dimValue);
                    }
                    catch (error)
                    {
                        this.log('Error trying to set dim value. Error: ' + error);
                    }
                }
                else if ((key === 'CT') && this.hasLightTemperature)
                {
                    try
                    {
                        let ctValue = Math.round((message['CT'] - 153) / 3.47) / 100;
                        if (this.updateCapabilityValue('light_temperature', ctValue))
                            this.updateCapabilityValue('light_mode', 'temperature');
                    }
                    catch (error)
                    {
                        this.log('Error trying to set light temperature value. Error: ' + error);
                    }
                }
                else if ((key === 'HSBColor') && this.hasLightColor)
                {
                    let values = message['HSBColor'].split(',')
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
                else if (key.startsWith('POWER'))
                {
                    this.powerReceived(key, message[key]);
                }
            });
        }
        if (this.powerMonitoring)
        {
            let powValues = message;
            if (powValues['StatusSNS'] !== undefined)
                powValues = powValues['StatusSNS'];
            powValues = powValues['ENERGY'];
            for (let key in powValues)
                if (PowerMeterCapabilities[key] !== undefined)
                    this.setCapabilityValue(PowerMeterCapabilities[key], powValues[key]); 
        }
    }
}

module.exports = TasmotaDevice;