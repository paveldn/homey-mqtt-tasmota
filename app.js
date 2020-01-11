'use strict';

const Homey = require('homey');


class TasmotaMqttApp extends Homey.App {
    
    onInit() {
        this.log(this.constructor.name + ' is running...');
    }
    
}

module.exports = TasmotaMqttApp;