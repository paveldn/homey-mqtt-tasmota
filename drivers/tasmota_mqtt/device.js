'use strict';

const Homey = require('homey');

class TasmoitaDevice extends Homey.Device {

    async onInit() {
        this.log('Device init');
        this.log('Name:', this.getName());
        this.log('Class:', this.getClass());
        this.log('Settings:',JSON.stringify(this.getSettings()));
        this.log('This:', JSON.stringify(this));
        this.driver = await this.getReadyDriver();
        this.log('driver:', JSON.stringify(this.driver));
        var settings = this.getSettings();
        this.relaysCount = parseInt(settings.relays_number)
        this.setUnavailable('Waiting for device status');
        this.unavailable = true;
        this.socketsList = [];
        for (let socketIndex=1; socketIndex <= this.relaysCount; socketIndex++)
            this.socketsList.push({name: 'socket '+socketIndex.toString()});
        this.driver.sendMessage('cmnd/' + settings['mqtt_topic'] + '/Status', '11');  // StatusSTS
        this.registerMultipleCapabilityListener(this.getCapabilities(), ( valueObj, optsObj ) => {
            let capName = Object.keys(valueObj)[0];
            if (capName.startsWith('onoff.'))
                this.sendTasmotaPowerCommand(capName.slice(-1), valueObj[capName] ? 'ON' : 'OFF') 
            return Promise.resolve();
        }, 500);
        if (this.hasCapability('multiplesockets'))
        {
            this.socketTrigger = new Homey.FlowCardTriggerDevice('multiplesockets_relay_state_changed');
            this.socketTrigger.register().registerRunListener((args, state) => {
                    return Promise.resolve(((args.socket_id.name === 'any socket') || (args.socket_id.name === state.socket_id.name)) &&
                                           ((args.state === 'state_any') || (args.state === state.state)));
                });
            this.socketTrigger.getArgument('socket_id').registerAutocompleteListener((query, args) => {
                    return Promise.resolve([{name: 'any socket'}].concat(this.socketsList));
                });
            this.socketCondition = new Homey.FlowCardCondition('multiplesockets_switch_turned_on');
            this.socketCondition.register().registerRunListener((args, state) => {
                    if ((args.socket_id.name === 'any socket') || (args.socket_id.name === 'all sockets'))
                    {
                        let orVal = false;
                        let andVal = true;
                        for (let socketIndex=1;socketIndex<=this.relaysCount;socketIndex++)
                        {
                            let cVal = this.getCapabilityValue('onoff.'+socketIndex.toString());
                            orVal |= cVal;
                            andVal &= cVal;
                        }
                        if (args.socket_id.name === 'any socket')
                            return Promise.resolve(orVal);
                        else
                            return Promise.resolve(andVal);
                    }                      
                    return Promise.resolve(this.getCapabilityValue('onoff.'+args.socket_id.name.slice(-1)) === true);
                });
            this.socketCondition.getArgument('socket_id').registerAutocompleteListener((query, args) => {
                    return Promise.resolve([{name: 'any socket'}, {name: 'all sockets'}].concat(this.socketsList));
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
                            this.sendTasmotaPowerCommand(socketIndex.toString(),valueToSend); 
                        return Promise.resolve(true);
                    }
                    this.sendTasmotaPowerCommand(args.socket_id.name.slice(-1),valueToSend); 
                    return Promise.resolve(true);
                });
            this.socketAction.getArgument('socket_id').registerAutocompleteListener((query, args) => {
                    return Promise.resolve([{name: 'all sockets'}].concat(this.socketsList));
                });
        }
        else
        {
            this.socketTrigger = new Homey.FlowCardTriggerDevice('singlesocket_relay_state_changed');
            this.socketTrigger.register().registerRunListener((args, state) => {
                    return Promise.resolve((args.state === 'state_any') || (args.state === state.state));
                })
            this.socketCondition = new Homey.FlowCardCondition('singlesocket_switch_turned_on');
            this.socketCondition.register().registerRunListener((args, state) => {
                    return Promise.resolve(this.getCapabilityValue('onoff.1') === true);
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
                    this.sendTasmotaPowerCommand('1',valueToSend); 
                    return Promise.resolve(true);
                });
        }

    }

    sendTasmotaPowerCommand(socketId, status) {
        let currentVal = this.getCapabilityValue('onoff.' + socketId);
        if ((status === 'TOGGLE') ||
           ((status === 'ON') &&  !currentVal) ||
           ((status === 'OFF') && currentVal))
                this.driver.sendMessage('cmnd/'+this.getMqttTopic()+'/POWER'+socketId, status);
    }

    getReadyDriver() {
        return new Promise(resolve => {
            let driver = this.getDriver();
            driver.ready(() => resolve(driver));
        });
    }
    
    getMqttTopic() {
        let topic = this.getSettings()['mqtt_topic'];
        return topic;
    }

    processMqttMessage(topic, message) {
        var topicParts = topic.split('/');
        if ((this.unavailable) && topicParts[2] === 'STATUS11')
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
                this.setAvailable();
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
            this.socketTrigger.trigger(this, {socket_index: parseInt(socketIndex), socket_state: newState}, newSt);;
        }
    }
}

module.exports = TasmoitaDevice;