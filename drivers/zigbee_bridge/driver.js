'use strict';

const Homey = require('homey');
const GeneralTasmotaDriver = require('../driver.js');

class ZigbeeBridgeDeviceDriver extends GeneralTasmotaDriver {
    
    onInit() {
        super.onInit();
    }

    pairingStarted() {
        this.log('pairingStarted called');
        this.devicesFound = {};
        this.sendMessage('cmnd/sonoffs/Status', '0');
        this.sendMessage('cmnd/tasmotas/Status', '0');
        this.sendMessage('sonoffs/cmnd/Status', '0');
        this.sendMessage('tasmotas/cmnd/Status', '0');
        this.sendMessage('cmnd/sonoffs/ZbStatus1', '');
        this.sendMessage('cmnd/tasmotas/ZbStatus1', '');
        this.sendMessage('sonoffs/cmnd/ZbStatus1', '');
        this.sendMessage('tasmotas/cmnd/ZbStatus1', '');
        return true;
    }
    
    collectedDataToDevice( deviceTopic, messages, swapPrefixTopic) {
        if (!('ZbStatus1' in messages))
            return null;
        let devItem = { 
            settings: {
                mqtt_topic: deviceTopic, 
                swap_prefix_topic: swapPrefixTopic, 
                chip_type: 'unknown'
            },
            capabilities: [],
            capabilitiesOptions: {},
            class: 'sensor',
            icon: 'icons/zigbee.svg'
        };
        if (('StatusMQT' in messages) && (messages['StatusMQT']['MqttClient'] !== undefined))
            devItem.data = { id: messages['StatusMQT']['MqttClient']};
        else
            return null;
        if ('Status' in messages)
        {
            if (messages['Status']['DeviceName'] !== undefined)
                devItem.name = messages['Status']['DeviceName'];
            else if (messages['Status']['FriendlyName'] !== undefined)
                devItem.name = messages['Status']['FriendlyName'][0];
            else
                devItem.name = deviceTopic;
        }
        if (('StatusFWR' in messages) && (messages['StatusFWR']['Hardware'] !== undefined))
            devItem.settings.chip_type = messages['StatusFWR']['Hardware'];
        return devItem;
    }

    pairingFinished( messagesCollected ) {
        this.log('pairingFinished called');
        this.log(`pairingFinished: messages collected ${JSON.stringify(messagesCollected)}`);
        let devices = [];
        Object.keys(messagesCollected).sort().forEach( key => {
            let devItem = this.collectedDataToDevice( key, messagesCollected[key].messages, messagesCollected[key].swapPrefixTopic);
            if (devItem !== null)
                devices.push(devItem);
        });
        this.log(`pairingFinished: devices found ${JSON.stringify(devices)}`);
        return devices;
    }
}

module.exports = ZigbeeBridgeDeviceDriver;