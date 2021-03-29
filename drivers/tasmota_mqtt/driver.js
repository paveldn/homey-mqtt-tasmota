'use strict';

const Homey = require('homey');

const TasmotaDevice = require('./device.js');
const Sensor = require('../sensor.js');
const GeneralTasmotaDriver = require('../driver.js');

class TasmotaDeviceDriver extends GeneralTasmotaDriver {
    
    onInit() {
        super.onInit();
    }

    onMapDeviceClass(device) {
        this.log(`Mapping device "${device.getName()}"`);
        // Sending SetOption59 to improve tele/* update behaviour for some HA implementation
        let settings = device.getSettings();
        let topic = settings.mqtt_topic;
        let command = 'SetOption59';
        if (settings.swap_prefix_topic)
            topic = topic + '/cmnd/' + command;
        else
            topic = 'cmnd/' + topic + '/' + command;
        this.sendMessage(topic, '1');
        return TasmotaDevice; 
    }
    
    pairingStarted() {
        this.log('pairingStarted called');
        this.devicesFound = {};
        this.sendMessage('cmnd/sonoffs/Status', '0');
        this.sendMessage('cmnd/tasmotas/Status', '0');
        this.sendMessage('sonoffs/cmnd/Status', '0');
        this.sendMessage('tasmotas/cmnd/Status', '0');
        return true;
    }
    
    collectedDataToDevice( deviceTopic, messages, swapPrefixTopic) {
        let devItem = { 
            settings: {
                mqtt_topic: deviceTopic, 
                swap_prefix_topic: swapPrefixTopic, 
                relays_number: '0', 
                is_dimmable: 'No', 
                has_lighttemp: 'No', 
                has_lightcolor: 'No', 
                has_fan: 'No', 
                shutters_number: '0', 
                chip_type: 'unknown'
            },
            capabilities: ['measure_signal_strength'],
            capabilitiesOptions: {},
            class: 'other',
            icon: 'icons/tasmota.svg'
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
        let shutters = 0;
        if ('StatusSNS' in messages)
        {
            // Sensors and shutters
            let sensors_settings = {};
            Sensor.forEachSensorValue(messages['StatusSNS'], (path, value) => {
                let capObj = Sensor.getPropertyObjectForSensorField(path, false);                
                let sensorField = path[path.length - 1];
                let sensor = "";
                if (path.length > 1)
                    sensor = path[path.length - 2]; 
                if (capObj !== null) {
                    this.log(`getPropertyObjectForSensorField: ${JSON.stringify(capObj)}`);
                    let units = capObj.units.default;
                    const units_field = capObj.units.units_field;
                    if ((units_field !== null) && (units_field in messages['StatusSNS']))
                        units = messages['StatusSNS'][units_field];
                    units = capObj.units.units_template.replace('{value}', units);
                    devItem.capabilities.push(capObj.capability);
                    devItem.capabilitiesOptions[capObj.capability] = {title: { en:  capObj.caption }, units:{ en: units } };
                    if (sensorField in sensors_settings)
                            sensors_settings[sensorField] = sensors_settings[sensorField] + 1;
                        else
                            sensors_settings[sensorField] = 1;
                        let u = capObj.units;                                          
                }
                else if (sensor.startsWith('Shutter')) {
                    shutters++;
                }
            });
            if (Object.keys(sensors_settings).length > 0)
            {
                devItem.capabilities.push('additional_sensors');
                let sens_string = [];
                for (const sitem in sensors_settings)
                    if (sensors_settings[sitem] > 1)
                        sens_string.push(sitem + ' (x' + sensors_settings[sitem] + ')');
                    else
                        sens_string.push(sitem);
                devItem.settings.additional_sensors = sens_string.join(', ');   
                devItem.icon = 'icons/sensor.svg';
                devItem.class = 'sensor';               
            }
            if (shutters > 0)
            {
                // Only Shutter1 supported
                devItem.capabilities.push('windowcoverings_state');
                devItem.capabilities.push('windowcoverings_set');
                devItem.settings.shutters_number = shutters.toString();
                devItem.class = 'blinds';
                devItem.icon = 'icons/curtains.svg';
            }
        }
        if ('StatusSTS' in messages)
        {
            // main section
            let relaysCount = 0;
            if (shutters === 0)
            {
                // Search for switches only if there is no shutters
                relaysCount = Object.keys(messages['StatusSTS']).filter(function(key) {
                    return key.startsWith('POWER');
                }).length;
                for (let propIndex = 1; propIndex <= relaysCount; propIndex++)
                {
                    let capId = 'switch.' + propIndex.toString();
                    devItem.capabilities.push(capId);
                    devItem.capabilitiesOptions[capId] = {title: { en: 'switch ' + propIndex.toString() }};
                }
                if (relaysCount > 0)
                {
                    devItem.capabilities.push('onoff');
                    devItem.capabilities.push(relaysCount > 1 ? 'multiplesockets' : 'singlesocket');
                }
            }
            devItem.settings.relays_number = relaysCount.toString();
            if (relaysCount === 1)
            {
                devItem.class = 'socket';
                devItem.icon = 'icons/power_socket.svg';
                if ('Dimmer' in messages['StatusSTS'])
                {
                    devItem.class = 'light';
                    devItem.icon = 'icons/light_bulb.svg';
                    devItem.settings.is_dimmable = 'Yes';
                    devItem.capabilities.push('dim');
                }
                let lmCounter = 0;
                if ('CT' in messages['StatusSTS'])
                {
                    devItem.capabilities.push('light_temperature');
                    devItem.settings.has_lighttemp = 'Yes';
                    lmCounter++;
                }
                if ('HSBColor' in messages['StatusSTS'])
                {
                    devItem.capabilities.push('light_hue');
                    devItem.capabilities.push('light_saturation');
                    devItem.settings.has_lightcolor = 'Yes';
                    lmCounter++;
                }
                if (lmCounter === 2)
                    capabilities.push('light_mode'); 
                if ('FanSpeed' in messages['StatusSTS'])
                {
                    devItem.icon = 'icons/table_fan.svg';
                    devItem.class = 'fan';
                    devItem.capabilities.push('fan_speed'); 
                    devItem.settings.has_fan = 'Yes';
                }
            }
            else if (relaysCount > 1)
            {
                devItem.icon = 'icons/power_strip.svg';
                devItem.class = 'other';
            }
        }
        if (devItem.capabilities.length === 0)
            return null;
        return devItem;
    }

    pairingFinished( messagesCollected ) {
        this.log('pairingFinished called');
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

module.exports = TasmotaDeviceDriver;