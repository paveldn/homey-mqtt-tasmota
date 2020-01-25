'use strict';

const Homey = require('homey');
const MQTTClient = new Homey.ApiApp('nl.scanno.mqtt');

class TasmotaDeviceDriver extends Homey.Driver {
    
    onInit() {
        this.log(this.constructor.name + ' has been inited');
        this.topics = ["stat", "tele"];
        this.devicesFound = {};
        this.searchingDevices = false;
        MQTTClient
            .register()
            .on('install', () => this.register())
            .on('uninstall', () => this.unregister())
            .on('realtime', (topic, message) => this.onMessage(topic, message));
        MQTTClient.getInstalled()
            .then(installed => {
                if (installed) {
                    this.register();
                }
            })
            .catch(error => {
                this.log(error)
            });
    }

    onPairListDevices( data, callback ) {
        this.log('onPairListDevices called');
        this.searchingDevices = true;
        this.devicesFound = {};
        this.sendMessage('cmnd/sonoffs/Status', '');   // Status
        this.sendMessage('cmnd/sonoffs/Status', '6');  // StatusMQT
        this.sendMessage('cmnd/sonoffs/Status', '2');  // StatusFWR
        this.sendMessage('cmnd/sonoffs/Status', '8');  // StatusSNS
        this.sendMessage('cmnd/tasmotas/Status', '');  // Status
        this.sendMessage('cmnd/tasmotas/Status', '6'); // StatusMQT
        this.sendMessage('cmnd/tasmotas/Status', '2'); // StatusFWR 
        this.sendMessage('cmnd/tasmotas/Status', '8'); // StatusSNS
        setTimeout(() => {
            this.searchingDevices = false;
            var devices = []
            for (var key in this.devicesFound)
            {
                let capabilities = [];
                let capabilitiesOptions = {};
                let relaysCount = this.devicesFound[key]['settings']['relays_number'];
                for (let propIndex = 0; propIndex < relaysCount; propIndex++)
                {
                    let capId = 'onoff.' + (propIndex + 1).toString();
                    capabilities.push(capId);
                    capabilitiesOptions[capId] = {title: { en: 'switch ' + (propIndex + 1).toString() }};
                }
                capabilities.push(relaysCount > 1 ? 'multiplesockets' : 'singlesocket');
                if (this.devicesFound[key]['settings']['pwr_monitor'])
                    capabilities.push('meter_power');
//                try {
                    if (this.devicesFound[key]['data'] !== undefined)
                    {
                        let devItem = {
                            name:   (this.devicesFound[key]['name'] === undefined) ? key :  this.devicesFound[key]['name'],
                            data:   this.devicesFound[key]['data'],
                            class:  relaysCount == 1 ? 'socket' : 'other',
                            store: {
                            },
                            settings:   {
                                mqtt_topic:     this.devicesFound[key]['settings']['mqtt_topic'],
                                relays_number:  this.devicesFound[key]['settings']['relays_number'].toString(),
                                pwr_monitor:    this.devicesFound[key]['settings']['pwr_monitor'] ? 'Yes' : 'No',
                                chip_type:      this.devicesFound[key]['settings']['chip_type'],
                            },
                            capabilities,
                            capabilitiesOptions
                        };
                        this.log('Device:',JSON.stringify(devItem));
                        devices.push(devItem);
                    }
//                }
//                catch (error) {
//                }
            }
            callback( null, devices);
        }, 10000);

    }

    onMessage(topic, message) {
        var now = new Date();
        var topicParts = topic.split('/');
        if (this.searchingDevices && (topicParts[0] === 'stat'))
        {
            if ((topicParts.length == 3) && ((topicParts[2] == 'STATUS') || (topicParts[2] == 'STATUS6') || (topicParts[2] == 'STATUS8') || (topicParts[2] == 'STATUS2')))
            {
                //try {
                    var deviceTopic = topicParts[1];
                    const msgObj = Object.values(message)[0];
                    if (this.devicesFound[deviceTopic] === undefined)
                        this.devicesFound[deviceTopic] = {settings: {mqtt_topic: deviceTopic, relays_number: 1, pwr_monitor: false, chip_type: 'unknown'}};
                    if (msgObj['FriendlyName'] !== undefined)
                    {
                        this.devicesFound[deviceTopic]['name'] = msgObj['FriendlyName'][0];
                        this.devicesFound[deviceTopic]['settings']['relays_number'] = msgObj['FriendlyName'].length;
                    }
                    if (msgObj['ENERGY'] !== undefined)
                        this.devicesFound[deviceTopic]['settings']['pwr_monitor'] = true;
                    if (msgObj['MqttClient'] !== undefined)
                        this.devicesFound[deviceTopic]['data'] = { id: msgObj['MqttClient']};
                    if (msgObj['Hardware'] !== undefined)
                        this.devicesFound[deviceTopic]['settings']['chip_type'] = msgObj['Hardware'];
                //}
                //catch (error) {
                //}
            }

        }
        if (this.topics.includes(topicParts[0]))
        {
            let devices = this.getDevices();
            for (let index = 0; index < devices.length; index++)
                if (devices[index].getMqttTopic() === topicParts[1])
                {
                    this.log("Hit: " + topic + " => " + JSON.stringify(message));
                    devices[index].processMqttMessage(topic, message);
                    break;
                }
        }
    }

    subscribeTopic(topicName) {
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
        for  (var topic in this.topics)
            this.subscribeTopic(this.topics[topic] + "/#");
    }

    unregister() {
        this.log(this.constructor.name + " unregister called");
    }


}

module.exports = TasmotaDeviceDriver;