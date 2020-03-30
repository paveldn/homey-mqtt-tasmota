'use strict';

const Homey = require('homey');
const MQTTClient = new Homey.ApiApp('nl.scanno.mqtt');
const PowerMeterCapabilities = require('./power')

class TasmotaDeviceDriver extends Homey.Driver {
    
    onInit() {
        this.log(this.constructor.name + ' has been initiated');
        this.log('Manifest: ' + JSON.stringify(this.getManifest()));
        this.topics = ["stat", "tele"];
        this.devicesFound = {};
        this.searchingDevices = false;
        this.checkDevices = setInterval(() => {
            try {
                this.updateDevices();
            } catch (error) { this.log(this.constructor.name + ' checkDevices error: ' + error); }
        }, 30000);
        this.clientAvailable = false;
        MQTTClient
            .register()
            .on('install', () => this.register())
            .on('uninstall', () => this.unregister())
            .on('realtime', (topic, message) => this.onMessage(topic, message));
        MQTTClient.getInstalled()
            .then(installed => {
                this.clientAvailable = installed;
                if (installed) {
                    this.register();
                }
            })
            .catch(error => {
                this.log(error)
            });
        this.log('MQTT client status: ' + this.clientAvailable); 
        this.deviceConnectionTrigger = new Homey.FlowCardTrigger('device_connection_changed').register();
    }

    updateDevices() {
        this.getDevices().forEach( device => {
            device.checkDeviceStatus();
        });
    }

    onDeviceStatusChange(device, newStatus, oldStatus) {
        if ((oldStatus === 'unavailable') && (newStatus === 'available'))
        {        
            this.deviceConnectionTrigger.trigger({name: device.getName(), device_id: device.getData().id, status: true}); 
        }
        else if ((oldStatus === 'available') && (newStatus === 'unavailable'))
        {
            this.deviceConnectionTrigger.trigger({name: device.getName(), device_id: device.getData().id, status: false}); 
        }
    }

    onPairListDevices( data, callback ) {
        this.log('onPairListDevices called');
        if (!this.clientAvailable)
            return callback(new Error(Homey.__('mqtt_client.unavailable')), null);
        this.devicesFound = {};
        this.messagesCounter = 0;
        this.searchingDevices = true;
        this.sendMessage('cmnd/sonoffs/Status', '0');
        this.sendMessage('cmnd/tasmotas/Status', '0');
        this.sendMessage('sonoffs/cmnd/Status', '0');
        this.sendMessage('tasmotas/cmnd/Status', '0');
        setTimeout( drvObj => {
            drvObj.searchingDevices = false;
            let devices = [];
            Object.keys(drvObj.devicesFound).sort().forEach( key => 
            {
                let capabilities = [];
                let capabilitiesOptions = {};
                let relaysCount = drvObj.devicesFound[key]['settings']['relays_number'];
                for (let propIndex = 1; propIndex <= relaysCount; propIndex++)
                {
                    let capId = 'switch.' + propIndex.toString();
                    capabilities.push(capId);
                    capabilitiesOptions[capId] = {title: { en: 'switch ' + propIndex.toString() }};
                }
                capabilities.push('onoff');
                capabilities.push(relaysCount > 1 ? 'multiplesockets' : 'singlesocket');
                for (let capItem in drvObj.devicesFound[key]['settings']['pwr_monitor'])
                    capabilities.push(drvObj.devicesFound[key]['settings']['pwr_monitor'][capItem]);
                try {
                    if (drvObj.devicesFound[key]['data'] !== undefined)
                    {
                        let devItem = {
                            name:   (drvObj.devicesFound[key]['name'] === undefined) ? key :  drvObj.devicesFound[key]['name'],
                            data:   drvObj.devicesFound[key]['data'],
                            class:  relaysCount == 1 ? 'socket' : 'other',
                            store: {
                            },
                            settings:   {
                                mqtt_topic:         drvObj.devicesFound[key]['settings']['mqtt_topic'],
                                swap_prefix_topic:  drvObj.devicesFound[key]['settings']['swap_prefix_topic'],
                                relays_number:      drvObj.devicesFound[key]['settings']['relays_number'].toString(),
                                pwr_monitor:        drvObj.devicesFound[key]['settings']['pwr_monitor'].length > 0 ? 'Yes' : 'No',
                                chip_type:          drvObj.devicesFound[key]['settings']['chip_type'],
                            },
                            capabilities,
                            capabilitiesOptions
                        };
                        drvObj.log('Device:',JSON.stringify(devItem));
                        devices.push(devItem);
                    }
                }
                catch (error) {
                    this.log('Error:', error);
                }
            });
            if (devices.length == 0)
            {
                if (this.messagesCounter === 0)
                    return callback(new Error(Homey.__('mqtt_client.no_messages')), null)
                else
                    return callback(new Error(Homey.__('mqtt_client.no_devices')), null)
            }
            return callback( null, devices);
        }, 10000, this);

    }

    onMessage(topic, message) {
        let now = new Date();
        let topicParts = topic.split('/');
        if (this.searchingDevices)
        {
            this.messagesCounter++;
            if ((topicParts[0] === 'stat') || (topicParts[1] === 'stat'))
            {
                let swapPrefixTopic = topicParts[1] === 'stat';
                if ((topicParts.length == 3) && ((topicParts[2] == 'STATUS') || (topicParts[2] == 'STATUS6') || (topicParts[2] == 'STATUS8') || (topicParts[2] == 'STATUS2')))
                {
                    try {
                        let deviceTopic = swapPrefixTopic ? topicParts[0] : topicParts[1];
                        const msgObj = Object.values(message)[0];
                        if (this.devicesFound[deviceTopic] === undefined)
                            this.devicesFound[deviceTopic] = {settings: {mqtt_topic: deviceTopic, swap_prefix_topic: swapPrefixTopic, relays_number: 1, pwr_monitor: [], chip_type: 'unknown'}};
                        if (msgObj['FriendlyName'] !== undefined)
                        {
                            this.devicesFound[deviceTopic]['name'] = msgObj['FriendlyName'][0];
                            this.devicesFound[deviceTopic]['settings']['relays_number'] = msgObj['FriendlyName'].length;
                        }   
                        if (msgObj['ENERGY'] !== undefined)
                        {
                            let energyKeys = Object.keys(msgObj['ENERGY']);
                            Object.keys(PowerMeterCapabilities).filter(value => energyKeys.includes(value)).forEach(key => this.devicesFound[deviceTopic]['settings']['pwr_monitor'].push(PowerMeterCapabilities[key]));
                        }
                        if (msgObj['MqttClient'] !== undefined)
                            this.devicesFound[deviceTopic]['data'] = { id: msgObj['MqttClient']};
                        if (msgObj['Hardware'] !== undefined)
                            this.devicesFound[deviceTopic]['settings']['chip_type'] = msgObj['Hardware'];
                    }
                    catch (error) {
                    }
                }
            }
        }
        let prefixFirst = this.topics.includes(topicParts[0]);
        if (prefixFirst || this.topics.includes(topicParts[1]))
        {
            let topicIndex = prefixFirst ? 1 : 0;
            let devices = this.getDevices();
            for (let index = 0; index < devices.length; index++)
                if (devices[index].getMqttTopic() === topicParts[topicIndex])
                {
                    devices[index].processMqttMessage(topic, message);
                    break;
                }
        }
    }

    subscribeTopic(topicName) {
        if (!this.clientAvailable)
            return;
        return MQTTClient.post('subscribe', { topic: topicName }, error => {
            if (error) {
                    this.log(error);
            } else {
                this.log('sucessfully subscribed to topic: ' + topicName);
            }
        });
    }

    sendMessage(topic, payload)
    {
        if (!this.clientAvailable)
            return;
        try {
            MQTTClient.post('send', {
                qos: 0,
                retain: false,
                mqttTopic: topic,
                mqttMessage: payload
           });
        } catch (error) {
            this.log(error);
        }
    }

    register() {
        this.clientAvailable = true;
        for  (let topic in this.topics)
        {
            this.subscribeTopic(this.topics[topic] + "/#");
            this.subscribeTopic("+/" + this.topics[topic] + "/#");
        }
    }

    unregister() {
        this.clientAvailable = false;
        this.log(this.constructor.name + " unregister called");
    }


}

module.exports = TasmotaDeviceDriver;