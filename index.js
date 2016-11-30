var request = require("request");
var http = require('http');
var url = require('url');
var Service, Characteristic;
var DEFAULT_REQUEST_TIMEOUT = 10000;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    homebridge.registerPlatform("homebridge-monoprice-multizone", "HttpMultizone", HttpMultizonePlatform);
    homebridge.registerAccessory("homebridge-monoprice-multizone", "HttpMultizoneSensor", HttpMultizoneSensorAccessory);
    homebridge.registerAccessory("homebridge-monoprice-multizone", "HttpMultizoneSwitch", HttpMultizoneSwitchAccessory);
};

function HttpMultizonePlatform(log, config){
    this.log = log;
    this.cacheDirectory = config["cache_directory"] || "./.node-persist/storage";
    this.webhookPort = config["webhook_port"] || 51828;
    this.sensors = config["sensors"] || [];
    this.switches = config["switches"] || [];
    this.storage = require('node-persist');
    this.storage.initSync({dir:this.cacheDirectory});
}

HttpMultizonePlatform.prototype = {

    accessories: function(callback) {
        var accessories = [];
        for(var i = 0; i < this.sensors.length; i++){
            var sensor = new HttpMultizoneSensorAccessory(this.log, this.sensors[i], this.storage);
            accessories.push(sensor);
        }

        for(var i = 0; i < this.switches.length; i++){
            var switchAccessory = new HttpMultizoneSwitchAccessory(this.log, this.switches[i], this.storage);
            accessories.push(switchAccessory);
        }
        var accessoriesCount = accessories.length;

        callback(accessories);

        http.createServer((function(request, response) {
            var theUrl = request.url;
            var theUrlParts = url.parse(theUrl, true);
            var theUrlParams = theUrlParts.query;
            var body = [];
            request.on('error', (function(err) {
                this.log("[ERROR Http WebHook Server] Reason: %s.", err);
            }).bind(this)).on('data', function(chunk) {
                body.push(chunk);
            }).on('end', (function() {
                body = Buffer.concat(body).toString();

                response.on('error', function(err) {
                    this.log("[ERROR Http WebHook Server] Reason: %s.", err);
                });

                response.statusCode = 200;
                response.setHeader('Content-Type', 'application/json');

                if(!theUrlParams.accessoryId) {
                    response.statusCode = 404;
                    response.setHeader("Content-Type", "text/plain");
                    var errorText = "[ERROR Http WebHook Server] No accessoryId in request.";
                    this.log(errorText);
                    response.write(errorText);
                    response.end();
                }
                else {
                    var responseBody = {
                        success: true
                    };
                    var accessoryId = theUrlParams.accessoryId;
                    for(var i = 0; i < accessoriesCount; i++){
                        var accessory = accessories[i];
                        if(accessory.id === accessoryId) {
                            if(!theUrlParams.state) {
                                var cachedState = this.storage.getItemSync("http-webhook-"+accessoryId);
                                if(cachedState === undefined) {
                                    cachedState = false;
                                }
                                responseBody = {
                                    success: true,
                                    state: cachedState
                                };
                            }
                            else {
                                var state = theUrlParams.state;
                                var stateBool = state==="true";
                                this.storage.setItemSync("http-webhook-"+accessoryId, stateBool);
                                //this.log("[INFO Http WebHook Server] State change of '%s' to '%s'.",accessory.id,stateBool);
                                accessory.changeHandler(stateBool);
                            }
                            break;
                        }
                    }
                    response.write(JSON.stringify(responseBody));
                    response.end();
                }
            }).bind(this));
        }).bind(this)).listen(this.webhookPort);
        this.log("Started server for webhooks on port '%s'.", this.webhookPort);
    }
}

function HttpMultizoneSensorAccessory(log, sensorConfig, storage) {
    this.log = log;
    this.id = sensorConfig["id"];
    this.name = sensorConfig["name"];
    this.type = sensorConfig["type"];
    this.storage = storage;

    if(this.type === "contact") {
        this.service = new Service.ContactSensor(this.name);
        this.changeHandler = (function(newState){
            this.log("Change HomeKit state for contact sensor to '%s'.", newState);
             this.service.getCharacteristic(Characteristic.ContactSensorState)
                    .setValue(newState ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED, undefined, 'fromHttpMultizone');
        }).bind(this);
        this.service
            .getCharacteristic(Characteristic.ContactSensorState)
            .on('get', this.getState.bind(this));
    } else if(this.type === "motion") {
        this.service = new Service.MotionSensor(this.name);
        this.changeHandler = (function(newState){
            //this.log("Change HomeKit state for motion sensor to '%s'.", newState);
            this.service.getCharacteristic(Characteristic.MotionDetected)
                    .setValue(newState, undefined, 'fromHttpMultizone');
        }).bind(this);
        this.service
            .getCharacteristic(Characteristic.MotionDetected)
            .on('get', this.getState.bind(this));
    } else if(this.type === "occupancy") {
        this.service = new Service.OccupancySensor(this.name);
        this.changeHandler = (function(newState){
            //this.log("Change HomeKit state for occupancy sensor to '%s'.", newState);
            this.service.getCharacteristic(Characteristic.OccupancyDetected)
                    .setValue(newState, undefined, 'fromHttpMultizone');
        }).bind(this);
        this.service
            .getCharacteristic(Characteristic.OccupancyDetected)
            .on('get', this.getState.bind(this));
    } else if(this.type === "smoke") {
        this.service = new Service.SmokeSensor(this.name);
        this.changeHandler = (function(newState){
            this.log("Change HomeKit state for smoke sensor to '%s'.", newState);
            this.service.getCharacteristic(Characteristic.SmokeDetected)
                    .setValue(newState, undefined, 'fromHttpMultizone');
        }).bind(this);
        this.service
            .getCharacteristic(Characteristic.SmokeDetected)
            .on('get', this.getState.bind(this));
    }
}

HttpMultizoneSensorAccessory.prototype.getState = function(callback) {
    this.log("Getting current state for '%s'...", this.id);
    var state = this.storage.getItemSync("http-webhook-"+this.id);
    if(state === undefined) {
        state = false;
    }
    if(this.type === "contact") {
        callback(null, state ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
    }
    else if(this.type === "smoke") {
        callback(null, state ? Characteristic.SmokeDetected.SMOKE_DETECTED : Characteristic.SmokeDetected.SMOKE_NOT_DETECTED);
    }
    else {
        callback(null, state);
    }
};

HttpMultizoneSensorAccessory.prototype.getServices = function() {
  return [this.service];
};

function HttpMultizoneSwitchAccessory(log, switchConfig, storage) {
    this.log = log;
    this.id = switchConfig["id"];
    this.name = switchConfig["name"];
    this.onURL = switchConfig["on_url"] || "";
    this.offURL = switchConfig["off_url"] || "";
    this.storage = storage;

    this.service = new Service.Switch(this.name);
    this.changeHandler = (function(newState) {
        this.log("Change HomeKit state for switch to '%s'.", newState);
        this.service.getCharacteristic(Characteristic.On)
                .setValue(newState, undefined, 'fromHttpMultizone');
    }).bind(this);
    this.service
        .getCharacteristic(Characteristic.On)
        .on('get', this.getState.bind(this))
        .on('set', this.setState.bind(this));
}

HttpMultizoneSwitchAccessory.prototype.getState = function(callback) {
    this.log("Getting current state for '%s'...", this.id);
    var state = this.storage.getItemSync("http-webhook-"+this.id);
    if(state === undefined) {
        state = false;
    }
    callback(null, state);
};

HttpMultizoneSwitchAccessory.prototype.setState = function(powerOn, callback) {
    this.log("Switch state for '%s'...", this.id);
    this.storage.setItemSync("http-webhook-"+this.id, powerOn);
    var urlToCall = this.onURL;
    if(!powerOn) {
        urlToCall = this.offURL;
    }
    if(urlToCall !== "") {
        request.get({
            url: urlToCall,
            timeout: DEFAULT_REQUEST_TIMEOUT
        }, (function(err, response, body) {
            var statusCode = response && response.statusCode ? response.statusCode: -1;
            this.log("Request to '%s' finished with status code '%s' and body '%s'.", url, statusCode, body, err);
            if (!err && statusCode == 200) {
                callback(null);
            }
            else {
                callback(err || new Error("Request to '"+url+"' was not succesful."));
            }
        }).bind(this));
    }
};

HttpMultizoneSwitchAccessory.prototype.getServices = function() {
  return [this.service];
};
