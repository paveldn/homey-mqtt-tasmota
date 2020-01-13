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
                try {
                    if (this.devicesFound[key]['data'] !== undefined)
                    {
                        if (this.devicesFound[key]['name'] === undefined)
                            this.devicesFound[key]['name'] = key;
                        devices.push(this.devicesFound[key]);
                    }
                }
                catch (error) {
                }


            callback( null, devices);
        }, 10000);

    }

    onMessage(topic, message) {
        var now = new Date();
        if (this.searchingDevices && topic.startsWith('stat/'))
        {
            let topicParts = topic.split('/');
            if ((topicParts.length == 3) && ((topicParts[2] == 'STATUS') || (topicParts[2] == 'STATUS6') || (topicParts[2] == 'STATUS8') || (topicParts[2] == 'STATUS2')))
            {
                //try {
                    let deviceTopic = topicParts[1];
                    const msgObj = Object.values(message)[0];
                    if (this.devicesFound[deviceTopic] === undefined)
                        this.devicesFound[deviceTopic] = {settings: {mqtt_topic: deviceTopic, pwr_monitor: 'No'}};
                    if (msgObj['FriendlyName'] !== undefined)
                    {
                        this.devicesFound[deviceTopic]['name'] = msgObj['FriendlyName'][0];
                        this.devicesFound[deviceTopic]['settings']['relays_number'] = msgObj['FriendlyName'].length.toString();
                    }
                    if (msgObj['ENERGY'] !== undefined)
                        this.devicesFound[deviceTopic]['settings']['pwr_monitor'] = 'Yes';
                    if (msgObj['MqttClient'] !== undefined)
                        this.devicesFound[deviceTopic]['data'] = { id: msgObj['MqttClient']};
                    if (msgObj['Hardware'] !== undefined)
                        this.devicesFound[deviceTopic]['settings']['chip_type'] = msgObj['Hardware'];
                    this.devicesFound[deviceTopic]['settings']['last_update'] = now.toISOString();
                //}
                //catch (error) {
                //}
            }

        }
        if (this.topics.includes(topic.split('/')[0]))
            this.log("Hit: " + topic + " => " + JSON.stringify(message));
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