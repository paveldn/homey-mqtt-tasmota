'use strict';

const Homey = require('homey');

const TasmotaDevice = require('./device.js');
const Sensor = require('./sensor.js')

class TasmotaDeviceDriver extends Homey.Driver {
    
    onInit() {
        this.debug = process.env.DEBUG == 1;
        this.log(`${this.constructor.name} has been initiated`);
        this.MQTTClient = this.homey.api.getApiApp('nl.scanno.mqtt');
        this.topics = ["stat", "tele"];
        this.ignoreTopicsWhenPairing = [];
        this.devicesFound = {};
        this.searchingDevices = false;
        this.checkDevices = setInterval(() => {
            try {
                this.updateDevices();
            }
            catch (error) 
            { 
                if (this.debug) 
                    throw(error);
                else 
                    this.log(`${this.constructor.name} checkDevices error: ${error}`);
            }
        }, 30000);
        this.clientAvailable = false;
        this.MQTTClient
            .on('install', () => this.register())
            .on('uninstall', () => this.unregister())
            .on('realtime', (topic, message) => this.onMessage(topic, message));
        try {
            this.MQTTClient.getInstalled()
                .then(installed => {
                    this.clientAvailable = installed;
                    this.log(`MQTT client status: ${this.clientAvailable}`); 
                    if (installed) {
                        this.register();
                    }
                });
        }
        catch(error) {
            this.log(`MQTT client app error: ${error}`);
        };
        this.deviceConnectionTrigger = this.homey.flow.getTriggerCard('device_connection_changed');
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
    
    onPair( session ) {
        this.log(`onPair called`);
        var driver = this;
        var devices = {};
        session.setHandler('list_devices', async (data) => {
            if (devices.length === 0)
            {
                if (driver.messagesCounter === 0)
                    return Promise.reject(new Error(driver.homey.__('mqtt_client.no_messages')));
                else
                    return Promise.reject(new Error(driver.homey.__('mqtt_client.no_new_devices')));
            }
            driver.log(`list_devices: New devices found: ${JSON.stringify(devices)}`);
            return devices;
        });
        session.setHandler('loading', async (data) => {

        });
        session.setHandler('showView', async (viewId) => {
            driver.log(`onPair current phase: "${viewId}"`);
            if (viewId === 'loading')
            {
                if (!driver.pairingStarted())
                    return Promise.reject(new Error(driver.homey.__('mqtt_client.unavailable')));
                let interval = setInterval( ( drvArg, sessionArg ) => {
                    if (drvArg.checkDeviceSearchStatus())
                    {
                        clearInterval(interval);
                        devices = drvArg.pairingFinished();
                        sessionArg.emit('list_devices', devices, function(error, result) {
                            if (result) {
                                sessionArg.nextView()
                            } else {
                                    sessionArg.alert('Can not show devices list', null, function() {
                                    sessionArg.done()
                                });
                            }
                        });
                        sessionArg.nextView();
                    }
                }, 2000, driver, session);
            }
        });
    }
    
    checkDeviceSearchStatus() {
        if ( this.checkDeviceSearchStatus.devicesCounter === undefined )
            this.checkDeviceSearchStatus.devicesCounter = 0;
        let devCount = Object.keys(this.devicesFound).length;
        if (devCount === this.checkDeviceSearchStatus.devicesCounter)
        {
            this.checkDeviceSearchStatus.devicesCounter = undefined;
            return true;
        }
        this.checkDeviceSearchStatus.devicesCounter = devCount;
        return false;
    }
    
    pairingStarted() {
        this.log('pairingStarted called');
        if (!this.clientAvailable)
            return false;
        this.devicesFound = {};
        this.messagesCounter = 0;
        this.searchingDevices = true;
        this.ignoreTopicsWhenPairing = [];
        this.getDevices().forEach(device => {
            this.ignoreTopicsWhenPairing.push(device.getMqttTopic());
        });
        this.log(`Topics to ignore during pairing: ${JSON.stringify(this.ignoreTopicsWhenPairing)}`);
        this.sendMessage('cmnd/sonoffs/Status', '0');
        this.sendMessage('cmnd/tasmotas/Status', '0');
        this.sendMessage('sonoffs/cmnd/Status', '0');
        this.sendMessage('tasmotas/cmnd/Status', '0');
        return true;
    }

    pairingFinished( ) {
        this.log('pairingFinished called');
        this.searchingDevices = false;
        let devices = [];
        Object.keys(this.devicesFound).sort().forEach( key => 
        {
            let capabilities = [];
            let capabilitiesOptions = {};
            let shuttersCount = this.devicesFound[key]['shutters'] ? this.devicesFound[key]['shutters'].length : 0;
            let relaysCount = shuttersCount === 0 ? this.devicesFound[key]['settings']['relays_number'] : 0;
            for (let propIndex = 1; propIndex <= relaysCount; propIndex++)
            {
                let capId = 'switch.' + propIndex.toString();
                capabilities.push(capId);
                capabilitiesOptions[capId] = {title: { en: 'switch ' + propIndex.toString() }};
            }
            if (relaysCount > 0)
            {
                capabilities.push('onoff');
                capabilities.push(relaysCount > 1 ? 'multiplesockets' : 'singlesocket');
            }
            for (const capItem in this.devicesFound[key]['settings']['pwr_monitor'])
                capabilities.push(this.devicesFound[key]['settings']['pwr_monitor'][capItem]);
            if (relaysCount === 1)
            {
                if (this.devicesFound[key]['settings']['is_dimmable'] === 'Yes')
                    capabilities.push('dim');
                let lmCounter = 0;
                if (this.devicesFound[key]['settings']['has_lighttemp'] === 'Yes')
                {
                    capabilities.push('light_temperature');
                    lmCounter++;
                }
                if (this.devicesFound[key]['settings']['has_lightcolor'] === 'Yes')
                {
                    capabilities.push('light_hue');
                    capabilities.push('light_saturation');
                    lmCounter++;
                }
                if (lmCounter === 2)
                    capabilities.push('light_mode'); 
            }
            if (shuttersCount > 0)
            {
                capabilities.push('windowcoverings_state');
                capabilities.push('windowcoverings_set');
            }
            if (this.devicesFound[key]['settings']['has_fan'] === 'Yes')
                capabilities.push('fan_speed'); 
            // Sensors
            for (const sensorindex in this.devicesFound[key]['sensors'])
            {
                let sensorCapObj = this.devicesFound[key]['sensors'][sensorindex];
                let units = sensorCapObj.units.default;
                const units_field = sensorCapObj.units.units_field;
                if ((units_field !== null) && (units_field in this.devicesFound[key]['sensors_attr']))
                    units = this.devicesFound[key]['sensors_attr'][units_field];
                units = sensorCapObj.units.units_template.replace('{value}', units);
                capabilities.push(sensorCapObj.capability);
                capabilitiesOptions[sensorCapObj.capability] = {title: { en:  sensorCapObj.caption }, units:{ en: units } };
            }
            try {
                if (this.devicesFound[key]['settings']['additional_sensors'])
                    capabilities.push('additional_sensors');
                if (this.devicesFound[key]['data'] !== undefined)
                {
					if (capabilities.length > 0)
					{
						let dev_class = 'other';
						let dev_icon = 'icons/power_socket.svg';
						if (this.devicesFound[key]['settings']['has_fan'] === 'Yes')
						{
							dev_icon = 'icons/table_fan.svg';
							dev_class = 'fan';
						}
						else if (shuttersCount > 0)
						{
							dev_class = 'blinds';
							dev_icon = 'icons/curtains.svg';
						}
						else if (relaysCount === 1)
						{
							if (this.devicesFound[key]['settings']['is_dimmable'] == 'Yes')
							{
								dev_class = 'light';
								dev_icon = 'icons/light_bulb.svg';
							}
							else
							{
								dev_class = 'socket';
								dev_icon = 'icons/power_socket.svg';
							}
						}
						else if (relaysCount === 0)
						{
							dev_icon = 'icons/sensor.svg';
							dev_class = 'sensor';
						}
						else
						{
							dev_icon = 'icons/power_strip.svg';
							dev_class = 'other';
						}
						let devItem = {
							name:   (this.devicesFound[key]['name'] === undefined) ? key :  this.devicesFound[key]['name'],
							data:   this.devicesFound[key]['data'],
							class:  dev_class,
							store: {
							},
							settings:   {
								mqtt_topic:         this.devicesFound[key]['settings']['mqtt_topic'],
								swap_prefix_topic:  this.devicesFound[key]['settings']['swap_prefix_topic'],
								relays_number:      relaysCount.toString(),
								pwr_monitor:        this.devicesFound[key]['settings']['pwr_monitor'].length > 0 ? 'Yes' : 'No',
								is_dimmable:        relaysCount === 1 ? this.devicesFound[key]['settings']['is_dimmable'] : 'No',
								has_lighttemp:      relaysCount === 1 ? this.devicesFound[key]['settings']['has_lighttemp'] : 'No',
								has_lightcolor:     relaysCount === 1 ? this.devicesFound[key]['settings']['has_lightcolor'] : 'No',
								has_fan:            this.devicesFound[key]['settings']['has_fan'],
								shutters_number:    shuttersCount.toString(),
								chip_type:          this.devicesFound[key]['settings']['chip_type'],
								additional_sensors: this.devicesFound[key]['settings']['additional_sensors'],
							},
							icon:   dev_icon,
							capabilities,
							capabilitiesOptions
						};

                        this.log(`Device found: "${devItem.settings.mqtt_topic}"`);
						devices.push(devItem);
                    }
					else
                        this.log(`Device ignored (no suported features): "${this.devicesFound[key]['settings']['mqtt_topic']}"`);
                }
            }
            catch (error) {
                if (this.debug) 
                    throw(error);
                else 
                    this.log(`Error: ${error}`);
            }
        });
        return devices;
    }
    
    onMessage(topic, message) {
        try {
            let now = new Date();
            let topicParts = topic.split('/');
            if (this.searchingDevices)
            {
                this.messagesCounter++;
                if ((topicParts[0] === 'stat') || (topicParts[1] === 'stat'))
                {
                    let swapPrefixTopic = topicParts[1] === 'stat';
                    if ((topicParts.length == 3) && ((topicParts[2] == 'STATUS') || (topicParts[2] == 'STATUS6') || (topicParts[2] == 'STATUS8') || (topicParts[2] == 'STATUS10') || (topicParts[2] == 'STATUS11') || (topicParts[2] == 'STATUS2')))
                    {
                        let deviceTopic = swapPrefixTopic ? topicParts[0] : topicParts[1];
                        if (!this.ignoreTopicsWhenPairing.includes(deviceTopic))
                        {
                            for (const msgKey of Object.keys(message))
                            {
                                this.log(`${deviceTopic}.${msgKey} => ${JSON.stringify(message[msgKey])}`);
                                const msgObj = message[msgKey];
                                if (this.devicesFound[deviceTopic] === undefined)
                                    this.devicesFound[deviceTopic] = {settings: {mqtt_topic: deviceTopic, swap_prefix_topic: swapPrefixTopic, relays_number: 0, pwr_monitor: [], is_dimmable: 'No', has_lighttemp: 'No', has_lightcolor: 'No', has_fan: 'No', shutters_number: 0, chip_type: 'unknown'}};
                                switch (msgKey)
                                {
                                    case 'Status':          // STATUS
                                        if (msgObj['DeviceName'] !== undefined)
                                            this.devicesFound[deviceTopic]['name'] = msgObj['DeviceName'];
                                        else if (msgObj['FriendlyName'] !== undefined)
                                            this.devicesFound[deviceTopic]['name'] = msgObj['FriendlyName'][0];
                                        break;
                                    case 'StatusFWR':       // STATUS2
                                        if (msgObj['Hardware'] !== undefined)
                                            this.devicesFound[deviceTopic]['settings']['chip_type'] = msgObj['Hardware'];
                                        break;
                                    case 'StatusMQT':       // STATUS6
                                        if (msgObj['MqttClient'] !== undefined)
                                            this.devicesFound[deviceTopic]['data'] = { id: msgObj['MqttClient']};                               
                                        break;
                                    case 'StatusSNS':       // STATUS8 and STATUS10
                                        let sensors = [];
                                        let sensorsAttr = {};
                                        let sensors_settings = {};
                                        let shutters = [];
                                        Sensor.forEachSensorValue(msgObj, (path, value) => {
                                            let capObj = Sensor.getPropertyObjectForSensorField(path, false);
                                            let sensorField = path[path.length - 1];
                                            let sensor = "";
                                            if (path.length > 1)
                                                sensor = path[path.length - 2]; 
                                            if (capObj !== null) {
                                                sensors.push(capObj);
                                                if (sensorField in sensors_settings)
                                                        sensors_settings[sensorField] = sensors_settings[sensorField] + 1;
                                                    else
                                                        sensors_settings[sensorField] = 1;
                                                    let u = capObj.units;
                                                    if ((capObj.units !== null) && (capObj.units.units_field !== null) && !(capObj.units.units_field in sensorsAttr) && (capObj.units.units_field in msgObj))
                                                        sensorsAttr[capObj.units.units_field] = msgObj[capObj.units.units_field];                                               
                                            }
                                            else if (sensor.startsWith('Shutter')) {
                                                shutters.push(sensorField);
                                            }
                                        });
                                        this.devicesFound[deviceTopic]['sensors'] = sensors;    
                                        this.devicesFound[deviceTopic]['sensors_attr'] = sensorsAttr;
                                        let sens_string = [];
                                        for (const sitem in sensors_settings)
                                            if (sensors_settings[sitem] > 1)
                                                sens_string.push(sitem + ' (x' + sensors_settings[sitem] + ')');
                                            else
                                                sens_string.push(sitem);
                                        this.devicesFound[deviceTopic]['settings']['additional_sensors'] = sens_string.join(', ');
                                        this.devicesFound[deviceTopic]['shutters'] = shutters;
                                        break;                                  
                                    case 'StatusSTS':       // STATUS11
                                        let switchNum = 0;
                                        for (const objKey in msgObj)
                                        {
                                            switch (objKey)
                                            {
                                                case 'FanSpeed':
                                                    this.devicesFound[deviceTopic]['settings']['has_fan'] = 'Yes';
                                                    break;
                                                case 'Dimmer':
                                                    this.devicesFound[deviceTopic]['settings']['is_dimmable'] = 'Yes';
                                                    break;
                                                case 'CT':
                                                    this.devicesFound[deviceTopic]['settings']['has_lighttemp'] = 'Yes';
                                                    break;
                                                case 'HSBColor':
                                                    this.devicesFound[deviceTopic]['settings']['has_lightcolor'] = 'Yes';
                                                    break;
                                                default:
                                                    if (objKey.match(/^POWER\d*$/))
                                                        switchNum++;
                                                    else
                                                        
                                                    break;
                                            }
                                        };
                                        this.devicesFound[deviceTopic]['settings']['relays_number'] = switchNum;
                                        break;
                                }
                            }
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
        catch (error) {
            if (this.debug) 
                throw(error);
            else 
                this.log(`onMessage error: ${error}`);
        }           
    }

    subscribeTopic(topicName) {
        if (!this.clientAvailable)
            return;
        return this.MQTTClient.post('subscribe', { topic: topicName }, error => {
            if (error) {
                    this.log(`Can not subscrive to topic ${topicName}, error: ${error}`)
            } else {
                this.log(`sucessfully subscribed to topic: ${topicName}`);
            }
        });
    }

    sendMessage(topic, payload)
    {
        if (!this.clientAvailable)
            return;
            this.MQTTClient.post('send', {
                qos: 0,
                retain: false,
                mqttTopic: topic,
                mqttMessage: payload
           }).catch ( error => {
            this.log(`Error while sending ${topic} <= "${payload}". ${error}`);
        });
    }

    register() {
        this.clientAvailable = true;
        for  (let topic in this.topics)
        {
            this.subscribeTopic(this.topics[topic] + "/#");
            this.subscribeTopic("+/" + this.topics[topic] + "/#");
        }
        this.getDevices().forEach( device => {
            device.updateDevice();
        });
    }

    unregister() {
        this.clientAvailable = false;
        this.log(`${this.constructor.name} unregister called`);
    }


}

module.exports = TasmotaDeviceDriver;