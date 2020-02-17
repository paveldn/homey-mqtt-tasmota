'use strict';

const Homey = require('homey');
const PowerMeterCapabilities = require('./power')

class TasmoitaDevice extends Homey.Device {

    async onInit() {
        this.log('Device init');
        this.log('Name:', this.getName());
        this.log('Class:', this.getClass());
        let settings = this.getSettings();
        this.log('Setting: ' + JSON.stringify(settings));
        this.driver = await this.getReadyDriver();
        this.relaysCount = parseInt(settings.relays_number);
        this.powerMonitoring = settings.pwr_monitor === 'Yes';
        let now = Date.now();
        this.update = {
            status: 'init',
            answerTimeout: undefined,
            nextRequest: now,
            updateInterval: settings.update_interval * 60 * 1000,
            timeoutInterval: 20 * 1000 
        };
        this.socketsList = [];
        for (let socketIndex=1; socketIndex <= this.relaysCount; socketIndex++)
            this.socketsList.push({name: 'socket '+socketIndex.toString()});
        this.invalidateStatus(Homey.__('device.unavailable.startup'));
        if (this.powerMonitoring)
            this.sendMessage('cmnd/' + this.getMqttTopic() + '/Status', '8');  // StatusSNS
        let onOffList = this.getCapabilities().filter( cap => cap.startsWith('onoff.') );
        if (onOffList.length > 0)
            this.registerMultipleCapabilityListener(onOffList, ( valueObj, optsObj ) => {
                let capName = Object.keys(valueObj)[0];
                this.sendTasmotaPowerCommand(capName.slice(-1), valueObj[capName] ? 'ON' : 'OFF') 
                return Promise.resolve();
            }, 500);
        if (this.hasCapability('multiplesockets'))
            this.registerMultipleSocketsFlows();
        else
            this.registerSingleSocketFlows();
    }

    getDeviceStatus() {
        return this.update.status;
    }

    sendMessage(topic, message) {
        this.driver.sendMessage(topic, message);
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
                return Promise.resolve(args.device.getCapabilityValue('onoff.'+args.socket_id.name.slice(-1)) === true);
            });
        this.socketCondition.getArgument('socket_id').registerAutocompleteListener((query, args) => {
                return Promise.resolve(args.device.socketsList);
            });
        this.socketConditionAll = new Homey.FlowCardCondition('multiplesockets_all_switches_turned_on'); 
        this.socketConditionAll.register().registerRunListener((args, state) => {
                for (let socketIndex=1;socketIndex<=args.device.relaysCount;socketIndex++)
                {
                    if (!args.device.getCapabilityValue('onoff.'+socketIndex.toString()))
                        return Promise.resolve(false);
                }
                return Promise.resolve(true);
            });
        this.socketConditionAny = new Homey.FlowCardCondition('multiplesockets_some_switches_turned_on'); 
        this.socketConditionAny.register().registerRunListener((args, state) => {
                for (let socketIndex=1;socketIndex<=args.device.relaysCount;socketIndex++)
                {
                    if (args.device.getCapabilityValue('onoff.'+socketIndex.toString()))
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
                return Promise.resolve(args.device.getCapabilityValue('onoff.1') === true);
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

    checkDeviceStatus() {
        let now = Date.now();
        if ((this.update.status === 'available') && (this.update.answerTimeout != undefined) && (now >= this.update.answerTimeout))
        {
            this.update.status = 'unavailable';
            this.invalidateStatus(Homey.__('device.unavailable.timeout'));
        }
        if (now >= this.update.nextRequest)
        {
            this.update.nextRequest = now + this.update.updateInterval;
            this.sendMessage('cmnd/' + this.getMqttTopic() + '/Status', '11');  // StatusSTS
        }
    }

    invalidateStatus(message) {
        this.setUnavailable(message);
        this.sendMessage('cmnd/' + this.getMqttTopic() + '/Status', '11');  // StatusSTS
    }

    sendTasmotaPowerCommand(socketId, status) {
        let currentVal = this.getCapabilityValue('onoff.' + socketId);
        if ((status === 'TOGGLE') ||
           ((status === 'ON') &&  !currentVal) ||
           ((status === 'OFF') && currentVal))
           {
                let topic = 'cmnd/'+this.getMqttTopic()+'/POWER'+socketId;
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
        if (changedKeysArr.includes('mqtt_topic'))
        {
            setTimeout(() => {
                this.update.status='init';
                this.invalidateStatus(Homey.__('device.unavailable.update'));
            }, 3000);
        }
        return callback(null, true);
    }

    processMqttMessage(topic, message) {
        let now = Date.now();
        let topicParts = topic.split('/');
        if ((topicParts[2] === 'LWT') && (message === 'Offline'))
        {
            this.update.status='unavailable';
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
                for (let i=0; i < this.relaysCount; i++)
                {
                    if ((i == 0) && (status['POWER'] !== undefined))
                    {
                        this.setCapabilityValue('onoff.1', status['POWER'] === 'ON');
                        check++;
                    }
                    else if (status['POWER'+(i+1).toString()] !== undefined)
                    {
                        this.setCapabilityValue('onoff.'+(i+1).toString(), status['POWER'+(i+1).toString()] === 'ON');
                        check++;
                    }
                }
                if (check === this.relaysCount)
                {
                    this.update.status = 'available';
                    this.setAvailable();
                }
            }
            else
                this.update.nextRequest = now;
        }
        if (this.update.status === 'unavailable')
        {
            this.update.status = 'available';
            this.setAvailable();
        }
        if (this.update.status === 'available')
        {
            this.update.nextRequest = now + this.update.updateInterval;
            this.update.answerTimeout = undefined;
        }
        if (topicParts[2].startsWith('POWER'))
        {
            let capName = '';
            let socketIndex = '';
            if (topicParts[2] === 'POWER')
            {
                capName = 'onoff.1';
                socketIndex = '1';
            }
            else
            {
                socketIndex = topicParts[2].slice(-1);
                capName = 'onoff.' + socketIndex;
            }
            let newState = message === 'ON';
            this.setCapabilityValue(capName, newState);
            let newSt = {};
            newSt['socket_id'] = {name: 'socket ' + socketIndex};
            newSt['state'] =  newState ? 'state_on' : 'state_off';
            this.socketTrigger.trigger(this, {socket_index: parseInt(socketIndex), socket_state: newState}, newSt);
            if (this.powerMonitoring)
                setTimeout(() => {
                    this.sendMessage('cmnd/' + this.getMqttTopic() + '/Status', '8');  // StatusSNS
                }, 3000);
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

module.exports = TasmoitaDevice;