'use strict';

const Homey = require('homey');

class TasmoitaDevice extends Homey.Device {
    
    // this method is called when the Device is inited
    async onInit() {
        this.log('Device init');
        this.log('Name:', this.getName());
        this.log('Class:', this.getClass());
        
        const settings = this.getSettings();
        this.log(JSON.stringify(settings));
        this.driver = await this.getReadyDriver();

        // register a capability listener
        this.registerCapabilityListener('onoff', this.onCapabilityOnoff.bind(this));
    }

    getReadyDriver() {
        return new Promise(resolve => {
            let driver = this.getDriver();
            driver.ready(() => resolve(driver));
        });
    }
    
    // this method is called when the Device has requested a state change (turned on or off)
    async onCapabilityOnoff( value, opts ) {
        this.log('Device:', this.getName(), "onCapabilityOnoff =>", value);
        this.log('Device: ' + JSON.stringify(this));
        // ... set value to real device, e.g.
        // await setMyDeviceState({ on: value });

        // or, throw an error
        // throw new Error('Switching the device failed!');
    }
}

module.exports = TasmoitaDevice;