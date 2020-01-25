'use strict';

const Homey = require('homey');

class TasmoitaDevice extends Homey.Device {

    // this method is called when the Device is inited
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
        this.driver.sendMessage('cmnd/' + settings['mqtt_topic'] + '/Status', '11');  // StatusSTS
        this.registerMultipleCapabilityListener(this.getCapabilities(), ( valueObj, optsObj ) => {
            let capName = Object.keys(valueObj)[0];
            if (capName.startsWith('onoff.'))
            {
                let topic = 'cmnd/' + this.getMqttTopic() + '/POWER' + capName.slice(-1);
                this.driver.sendMessage(topic, valueObj[capName] ? 'ON' : 'OFF');  
            }
            return Promise.resolve();
        }, 500);
        if (this.hasCapability('multiplesockets'))
        {
            this.socketTrigger = new Homey.FlowCardTriggerDevice('multiplesockets_relay_state_changed');
            this.socketTrigger.register().registerRunListener((args, state) => {
                    return Promise.resolve(((args.socket_id.name === 'any socket') || (args.socket_id.name === state.socket_id.name)) &&
                                           ((args.state === 'state_any') || (args.state === state.state)));
                })
            this.socketTrigger.getArgument('socket_id').registerAutocompleteListener((query, args) => {
                    let result = [{name: 'any socket'}];
                    for (let socketIndex=1; socketIndex <= this.relaysCount; socketIndex++)
                        result.push({name: 'socket '+socketIndex.toString()});
                    return Promise.resolve(result);
                })
        }
        else
        {
            this.socketTrigger = new Homey.FlowCardTriggerDevice('singlesocket_relay_state_changed');
            this.socketTrigger.register().registerRunListener((args, state) => {
                    return Promise.resolve((args.state === 'state_any') || (args.state === state.state));
                })
        }
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
                socketIndex = topicParts[2][5];
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