const convertOnOffToBool = (value) => {
    return value === 'ON';
}

const LinkQualityToPercentage = (value) => {
	return Math.ceil(value * 100 / 254);
}

const WaterAlarmConverter = (value) => {
	return value === "010000FF0000";
}

const SensorsCapabilities = {
    'Temperature': [
        { sensor_filter: '*',               caption: 'Temperature ({name})',           capability: 'measure_temperature.{sensor}',                value_converter: null,                  units: { default: 'C',          units_field: 'TempUnit',            units_template: '°{value}' } },
    ],
    'Humidity': [
        { sensor_filter: '*',               caption: 'Humidity ({name})',              capability: 'measure_humidity.{sensor}',                   value_converter: null,                  units: { default: '%',          units_field: null,                  units_template: '{value}' } },       
    ],
    'DewPoint': [
        { sensor_filter: '*',               caption: 'Dew point ({name})',             capability: 'measure_temperature.dew_point.{sensor}',      value_converter: null,                  units: { default: 'C',          units_field: 'TempUnit',            units_template: '°{value}' } },
    ],
    'Pressure': [
        { sensor_filter: '*',               caption: 'Pressure ({name})',              capability: 'measure_pressure.{sensor}',                   value_converter: null,                  units: { default: 'hPa',        units_field: 'PressureUnit',        units_template: '{value}' } },
    ],
    'CarbonDioxide': [
        { sensor_filter: '*',               caption: 'Carbon dioxide ({name})',        capability: 'measure_co2.{sensor}',                        value_converter: null,                  units: { default: 'ppm',        units_field: null,                  units_template: '{value}' } },   
    ],
    'Illuminance': [
        { sensor_filter: '*',               caption: 'Illuminance ({name})',           capability: 'measure_luminance.{sensor}',                  value_converter: null,                  units: { default: 'lx',         units_field: null,                  units_template: '{value}' } },     
    ],
    'CF1': [
        { sensor_filter: '*',               caption: 'CF1 ({name})',                   capability: 'measure_particulate_matter.cf1.{sensor}',     value_converter: null,                  units: { default: 'µg/m³',      units_field: null,                  units_template: '{value}' } },
    ],
    'CF2.5': [
        { sensor_filter: '*',               caption: 'CF2.5 ({name})',                 capability: 'measure_particulate_matter.cf2_5.{sensor}',   value_converter: null,                  units: { default: 'µg/m³',      units_field: null,                  units_template: '{value}' } },
    ],
    'CF10': [
        { sensor_filter: '*',               caption: 'CF10 ({name})',                  capability: 'measure_particulate_matter.cf10.{sensor}',    value_converter: null,                  units: { default: 'µg/m³',      units_field: null,                  units_template: '{value}' } },
    ],
    'PM1': [
        { sensor_filter: '*',               caption: 'PM1 ({name})',                   capability: 'measure_particulate_matter.pm1.{sensor}',     value_converter: null,                  units: { default: 'ppd',        units_field: null,                  units_template: '{value}' } },
    ],
    'PM2.5': [
        { sensor_filter: '*',               caption: 'PM2.5 ({name})',                 capability: 'measure_particulate_matter.pm2_5.{sensor}',   value_converter: null,                  units: { default: 'ppd',        units_field: null,                  units_template: '{value}' } },
    ],
    'PM10': [
        { sensor_filter: '*',               caption: 'PM10 ({name})',                  capability: 'measure_particulate_matter.pm10.{sensor}',    value_converter: null,                  units: { default: 'ppd',        units_field: null,                  units_template: '{value}' } },
    ],
    'PB0.3': [
        { sensor_filter: '*',               caption: 'PB0.3 ({name})',                 capability: 'measure_particulate_matter.pb0_3.{sensor}',   value_converter: null,                  units: { default: 'ppd',        units_field: null,                  units_template: '{value}' } },
    ],
    'PB0.5': [
        { sensor_filter: '*',               caption: 'PB0.5 ({name})',                 capability: 'measure_particulate_matter.pb0_5.{sensor}',   value_converter: null,                  units: { default: 'ppd',        units_field: null,                  units_template: '{value}' } },
    ],
    'PB1': [
        { sensor_filter: '*',               caption: 'PB1 ({name})',                   capability: 'measure_particulate_matter.pb1.{sensor}',     value_converter: null,                  units: { default: 'ppd',        units_field: null,                  units_template: '{value}' } },
    ],
    'PB2.5': [
        { sensor_filter: '*',               caption: 'PB2.5 ({name})',                 capability: 'measure_particulate_matter.pb2_5.{sensor}',   value_converter: null,                  units: { default: 'ppd',        units_field: null,                  units_template: '{value}' } },
    ],
    'PB5': [
        { sensor_filter: '*',               caption: 'PB5 ({name})',                   capability: 'measure_particulate_matter.pb5.{sensor}',     value_converter: null,                  units: { default: 'ppd',        units_field: null,                  units_template: '{value}' } },
    ],
    'PB10':  [
        { sensor_filter: '*',               caption: 'PB10 ({name})',                  capability: 'measure_particulate_matter.pb10.{sensor}',    value_converter: null,                  units: { default: 'ppd',        units_field: null,                  units_template: '{value}' } },
    ],
    'UvLevel': [
        { sensor_filter: '*',               caption: 'UV index ({name})',              capability: 'measure_ultraviolet.{sensor}',                value_converter: null,                  units: { default: '',           units_field: null,                  units_template: '{value}' } },
    ],
    'Frequency': [
        { sensor_filter: '*',               caption: 'Frequency ({name})',             capability: 'measure_frequency.{sensor}',                  value_converter: null,                  units: { default: 'Hz',         units_field: null,                  units_template: '{value}' } },
    ],
    'Voltage': [
        { sensor_filter: 'ENERGY',          caption: 'Voltage',                        capability: 'measure_voltage',                             value_converter: null,                  units: { default: 'V',          units_field: null,                  units_template: '{value}' } },
        { sensor_filter: '*',               caption: 'Voltage ({name})',               capability: 'measure_voltage.{sensor}',                    value_converter: null,                  units: { default: 'V',          units_field: null,                  units_template: '{value}' } },
    ],
    'Current': [
        { sensor_filter: 'ENERGY',          caption: 'Current',                        capability: 'measure_current',                             value_converter: null,                  units: { default: 'A',          units_field: null,                  units_template: '{value}' } },
        { sensor_filter: '*',               caption: 'Current ({name})',               capability: 'measure_current.{sensor}',                    value_converter: null,                  units: { default: 'A',          units_field: null,                  units_template: '{value}' } },
    ],
    'Power': [
        { sensor_filter: 'ENERGY',          caption: 'Power',                          capability: 'measure_power',                               value_converter: null,                  units: { default: 'W',          units_field: null,                  units_template: '{value}' } },
        { sensor_filter: '*',               caption: 'Power ({name})',                 capability: 'measure_power.{sensor}',                      value_converter: null,                  units: { default: 'W',          units_field: null,                  units_template: '{value}' } },
    ],
    'Factor': [
        { sensor_filter: 'ENERGY',          caption: 'Power factor',                   capability: 'measure_power_factor',                        value_converter: null,                  units: { default: '',           units_field: null,                  units_template: '{value}' } },
        { sensor_filter: '*',               caption: 'Power factor ({name})',          capability: 'measure_power_factor.{sensor}',               value_converter: null,                  units: { default: '',           units_field: null,                  units_template: '{value}' } },
    ],
    'ApparentPower': [
        { sensor_filter: 'ENERGY',          caption: 'Apparent power',                 capability: 'measure_apparent_power',                      value_converter: null,                  units: { default: 'VA',         units_field: null,                  units_template: '{value}' } },
        { sensor_filter: '*',               caption: 'Apparent power ({name})',        capability: 'measure_apparent_power.{sensor}',             value_converter: null,                  units: { default: 'VA',         units_field: null,                  units_template: '{value}' } },
    ],
    'ReactivePower': [
        { sensor_filter: 'ENERGY',          caption: 'Reactive power',                 capability: 'measure_power_reactive',                      value_converter: null,                  units: { default: 'VAr',        units_field: null,                  units_template: '{value}' } },
        { sensor_filter: '*',               caption: 'Reactive power ({name})',        capability: 'measure_power_reactive.{sensor}',             value_converter: null,                  units: { default: 'VAr',        units_field: null,                  units_template: '{value}' } },
    ],
    'Total': [
        { sensor_filter: 'ENERGY',          caption: 'Power meter',                    capability: 'meter_power',                                 value_converter: null,                  units: { default: 'kWh',        units_field: null,                  units_template: '{value}' } },
        { sensor_filter: '*',               caption: 'Power meter ({name})',           capability: 'meter_power.{sensor}',                        value_converter: null,                  units: { default: 'kWh',        units_field: null,                  units_template: '{value}' } },
    ],
    'Today': [
        { sensor_filter: 'ENERGY',          caption: 'Power meter today',              capability: 'meter_energy_today',                          value_converter: null,                  units: { default: 'kWh',        units_field: null,                  units_template: '{value}' } },
        { sensor_filter: '*',               caption: 'Power meter today ({name})',     capability: 'meter_energy_today.{sensor}',                 value_converter: null,                  units: { default: 'kWh',        units_field: null,                  units_template: '{value}' } },
    ],
    'Yesterday': [
        { sensor_filter: 'ENERGY',          caption: 'Power meter yesterday',          capability: 'meter_energy_yesterday',                      value_converter: null,                  units: { default: 'kWh',        units_field: null,                  units_template: '{value}' } },
        { sensor_filter: '*',               caption: 'Power meter yesterday ({name})', capability: 'meter_energy_yesterday.{sensor}',             value_converter: null,                  units: { default: 'kWh',        units_field: null,                  units_template: '{value}' } },
    ],
    'SeaPressure': [
        { sensor_filter: '*',               caption: 'Sea level pressure ({name})',    capability: 'measure_pressure.see_level.{sensor}',         value_converter: null,                  units: { default: 'hPa',        units_field: 'PressureUnit',        units_template: '{value}' } },
    ],
    'TVOC':[
        { sensor_filter: '*',               caption: 'TVOC ({name})',                  capability: 'measure_tvoc.{sensor}',                       value_converter: null,                  units: { default: 'ppb',        units_field: null,                  units_template: '{value}' } },
    ],
    'eCO2':[
        { sensor_filter: '*',               caption: 'Equivalent CO\u2082 ({name})',   capability: 'measure_co2.eco2.{sensor}',                   value_converter: null,                  units: { default: 'ppm',        units_field: null,                  units_template: '{value}' } },  
    ],
    'A':[
        { sensor_filter: '*',               caption: 'Analog {index} ({name})',        capability: 'measure_analog.{sensor}.{index}',             value_converter: null,                  units: { default: '',           units_field: null,                  units_template: '' } },
    ],
    'Switch': [
        { sensor_filter: '*',               caption: 'Switch {index}',                 capability: 'sensor_switch.{index}',                       value_converter: convertOnOffToBool,    units: { default: '',           units_field: null,                  units_template: '' } },
    ],
    'C': [
        { sensor_filter: 'COUNTER',         caption: 'Counter {index}',                capability: 'sensor_counter.{index}',                      value_converter: null,                  units: { default: '',            units_field: null,                  units_template: '' } },
    ],
    'BatteryPercentage': [
        { sensor_filter: '*',               caption: 'Battery ({name})',       		   capability: 'measure_battery_level.{sensor}',              value_converter: null,    			  units: { default: '%',           units_field: null,                  units_template: '{value}' } },
    ],
    'LinkQuality': [
        { sensor_filter: '*',               caption: 'Signal ({name})',       		   capability: 'measure_signal_strength.{sensor}',            value_converter: LinkQualityToPercentage, units: { default: '%',         units_field: null,                  units_template: '{value}' } },
    ],
	'0500<00': [
        { sensor_filter: '*',               caption: 'Water alarm ({name})',       	   capability: 'alarm_water.{sensor}',                        value_converter: WaterAlarmConverter,    units: { default: '',           units_field: null,                  units_template: '' } },
    ],
};

var PropertyObjectsCache = 
{
};

const forEachSensorValue = (root, lambda) => {
    let paths = [];
    let nodes = [{
        obj: root,
        path: []
    }];
    while (nodes.length > 0) {
        let n = nodes.pop();
        try {
            Object.keys(n.obj).forEach(k => {
                let path = n.path.concat(k);
                let value = n.obj[k];
                if ((value !== null) && (typeof value === 'object')) {
                    
                    paths.push(path);
                    nodes.unshift({
                        obj: value,
                        path: path
                    });
                }
                else
                {
                    lambda(path, value);
                }
            });
        }
        catch(error) 
        {};
    }
};

const sensorNameRegExp = new RegExp('^(?<name>.+)(?<index>[0-9]+)$');

const parseSensorValueName = (stringName) => {
    let regExpRes = sensorNameRegExp.exec(stringName);
    if (regExpRes !== null)
    {
        return { name: regExpRes.groups.name, index: regExpRes.groups.index };
    }
    else
        return null;
}

const getPropertyObjectForSensorField = (path, cache_result, device_attributes) => {
    if (cache_result === undefined)
        cache_result = true;
	if (!device_attributes)
	{
		let pVal = path.length >= 2 ? path[path.length - 2]: 'unknown';
		device_attributes = {
			'sensor': pVal,
			'name': pVal
		};
	}
    let recId = path.join('.');
    let result = null;
    if (recId in PropertyObjectsCache)
        result = PropertyObjectsCache[recId];
    else 
    {
        let valueField = path[path.length - 1];
        let sensor = "";
        if (path.length >= 2)
            sensor = path[path.length - 2];
        let filters = [];
        let valueIndex = "";
        let valueType = "";
        if (valueField in SensorsCapabilities)
        {
            valueType = valueField;
            filters = SensorsCapabilities[valueType];
        }
        else
        {
            let parseRes = parseSensorValueName(valueField);
            if ((parseRes !== null) && (parseRes.name in SensorsCapabilities))
            {
                valueType = parseRes.name;
                valueIndex = parseRes.index;
                filters = SensorsCapabilities[valueType];
            }
        }
        let filtersCount = filters.length;
        for (let filterIndex = 0; filterIndex < filtersCount; filterIndex++) {
            if ((filters[filterIndex].sensor_filter === '*') || (filters[filterIndex].sensor_filter === device_attributes.sensor)  || device_attributes.sensor.startsWith(filters[filterIndex].sensor_filter + '-'))
            {
                result = {};
                Object.assign(result, filters[filterIndex]);
                result.caption = result.caption.replace('{index}', valueIndex).replace('{sensor}', device_attributes.sensor).replace('{name}', device_attributes.name);
                result.capability = result.capability.replace('{index}', valueIndex).replace('{sensor}', device_attributes.sensor).replace('{name}', device_attributes.name);
                result.cached = false;
                break;
            }
        }
        if (cache_result)
        {
            if (result !== null)
            {
                PropertyObjectsCache[recId] = {};
                Object.assign(PropertyObjectsCache[recId], result);
                PropertyObjectsCache[recId].cached = true;
            }
            else
                PropertyObjectsCache[recId] = null;
        }
    }
    return result;
}

module.exports.forEachSensorValue = forEachSensorValue;
module.exports.getPropertyObjectForSensorField = getPropertyObjectForSensorField;
module.exports.SensorsCapabilities = SensorsCapabilities;