'use strict';

var d3demo = d3demo || {};

d3demo.random = (function dataSimulator(d3, Rx) {
  var GENERAL_SESSIONS_ID = 1
    , ENTRANCE_ID = 0
    , LUNCH1_ID = 2
    , LUNCH2_ID = 3

  var KEYNOTE_1_START_MINUTES = 10*60
    , KEYNOTE_2_START_MINUTES = 14*60
    , LUNCH_TIME = 12*60
    , START_MINUTES = 7*60 + 50
    , END_MINUTES = 18*60;

  var EVENT_DATE = new Date('2015-06-23').getTime() + 7 * 60 * 60 * 1000;

  // Returns a random integer between min included) and max (excluded)
  var getRandom = function (min, max) {
    return Math.random() * (max - min) + min;
  };

  var getRandomInt = function (min, max) {
    return Math.floor(getRandom(min,max));
  };

  var users = [];
  // initialize the users
  for (var i = 0; i < 200; i++) {
    users.push({
      id: i
    , name: i === 13 ? 'Burr Sutter' : 'Firstname' + i + ' Lastname' + i
    });
  };

  var locationWeights = [4, 0, 0, 0, 30, 80, 30, 20, 50, 50, 35];
  var getLocationWeight = function(location, minutes) {
    if (location.id === GENERAL_SESSIONS_ID && KEYNOTE_1_START_MINUTES - 10 <= minutes && minutes <= KEYNOTE_1_START_MINUTES + 10) {
      return 6000;
    };
    if (location.id === GENERAL_SESSIONS_ID && KEYNOTE_2_START_MINUTES - 10 <= minutes && minutes <= KEYNOTE_2_START_MINUTES + 10) {
      return 3000;
    };
    if ((location.id === LUNCH1_ID || location.id === LUNCH2_ID) && LUNCH_TIME - 5 <= minutes && minutes <= LUNCH_TIME + 25) {
      return 3000;
    };
    if (location.id === ENTRANCE_ID && minutes > END_MINUTES - 60) {
      return 6000;
    };
    return locationWeights[location.id];
  }

  var getRandomLocation = function(minutes) {
    var totalWeight = d3demo.layout.locations.reduce(function (sumSoFar, location, index, array) {
      return sumSoFar + getLocationWeight(location, minutes);
    }, 0);
    var random = getRandom(0, totalWeight)
      , sum = 0
      , randomLocation;
    for (var i = 0; i < d3demo.layout.locations.length; i++) {
      var location = d3demo.layout.locations[i];
      sum += getLocationWeight(location, minutes);
      if (random < sum) {
        randomLocation = d3demo.layout.locations[i];
        break;
      }
    }
    return randomLocation;
  };

  var previousScans = {};

  var createRandomScan = function (user, minutes) {
    var lastScan = previousScans[user.id];
    var userLeft = lastScan && lastScan.location.id === ENTRANCE_ID && lastScan.type === 'check-out';
    var present = lastScan && !userLeft
    var checkedIn = present && lastScan.type === 'check-in';
    var atEntrance = present && lastScan.location.id === ENTRANCE_ID;

    var scan;
    if (checkedIn && ! atEntrance) {
      scan = {
        user: user
      , location: lastScan.location
      , type: 'check-out'
      }
    } else {
      var location = getRandomLocation(minutes);
      var type = (location.id == ENTRANCE_ID && (present || minutes > END_MINUTES - 60))
        ? 'check-out'
        : 'check-in';
      scan = {
        user: user
      , location: location
      , type: type
      }
    }
    previousScans[user.id] = scan;
    return scan;
  }

  var pauser = new Rx.Subject();

  var counter = Rx.Observable.interval(50)
    .map(function(n) {
      var minutes = START_MINUTES + n; // increment in 1 minute increments
      return {
        n: n
      , minutes: minutes
      , timestamp: EVENT_DATE + minutes * 60 * 1000 // timestamp in ms
      }
    })
    .takeWhile(function(tick) {
      return tick.minutes <= END_MINUTES;
      // return tick.minutes <= START_MINUTES + 20;
    })
    .pausable(pauser).publish();

  var playbackClock = counter.filter(function(tick) {
      return tick.timestamp % 300000 === 0;
    }).pausable(pauser).publish();

  var eventLog = {};

  var intervalFromEvents = function(events) {
    var stream;
    if (!events || !events.length) {
       stream = Rx.Observable.empty();
    } else {
      stream = Rx.Observable.range(0, events.length).map(function(n) {
        return events[n];
      }).take(events.length);
    }
    return stream;
  };

  var randomScans = counter.flatMap(function(tick) {
    var scans = [];
    var rush = (tick.minutes + 5) % 60;
    if (rush > 30) { rush = 60 - rush};
    var numEvents = rush < 10 ? 100 - rush : getRandomInt(0,3); // simulate a rush
    for (var n = 0; n < numEvents; n++) {
      var user = users[getRandomInt(0, users.length)];
      var scan = createRandomScan(user, tick.minutes);
      var eventTimeOffest = getRandomInt(0, 60).toFixed(4);
      scan.timestamp = tick.timestamp + eventTimeOffest * 1000
      scans.push(scan);
    };
    if (scans.length) {
      var binTime = tick.timestamp;
      eventLog[binTime] = scans;
    }
    return intervalFromEvents(scans);
  }).pausable(pauser).publish();

  // randomScans.subscribe(function() {}, function(error) {console.log(error.stack);}, function() {
  //     eventLog.startTimestamp = EVENT_DATE;
  //     console.log(JSON.stringify(eventLog, function(key, value) {
  //       if (key === 'location') {
  //         return value.id;
  //       } else if (key[0] == '_') {
  //         return undefined;
  //       }
  //       return value;
  //     }, 2));
  //     analyzePlaybackData(eventLog);
  //   }
  // );

  var playbackRandom = function(cb) {
    previousScans = {};
    cb(playbackClock, randomScans);
    pauser.onNext(false);
    counter.connect();
    playbackClock.connect();
    randomScans.connect();
    pauser.onNext(true);
  };

  var playbackScans = function(cb) {
    d3.json('/event_log.json', function(error, json) {
      if (error) {
        console.log(error)
      }
      analyzePlaybackData(json)
      var playBackSource = counter.filter(function(tick) {
        return tick.timestamp % 3000 === 0;
      })
      .flatMap(function(tick) {

        var events = json[tick.timestamp];
        if (events) {
          events.forEach(function(event) {
            event.scanner.location = d3demo.layout.locations[event.scanner.location];
          })
        }
        return intervalFromEvents(events);
      })
      .pausable(pauser).publish();

      cb(playbackClock, playBackSource);
      pauser.onNext(false);
      counter.connect();
      playbackClock.connect();
      playBackSource.connect();
      pauser.onNext(true);
    });
  }

  var analyzePlaybackData = function(json) {
    function compareNumbers(a, b) {
      return a - b;
    }

    var eventTimes = Object.keys(json).map(function(time) {
      return parseInt(time);
    }).filter(function(time) {
      return !isNaN(time);
    }).sort(compareNumbers);

    var deltaMap = {}
      , previousTime = 0
      , sum = 0
      , numEventsPerInterval = [];
    eventTimes.forEach(function(binTime) {
      var numEvents = json[binTime].length;
      numEventsPerInterval[numEvents] = numEventsPerInterval[numEvents] || 0;
      numEventsPerInterval[numEvents]++;
      sum += json[binTime].length;
      if (previousTime) {
        deltaMap[binTime - previousTime] = true;
      }
      previousTime = binTime;
    });
    var deltas = Object.keys(deltaMap).map(function(time) {
      return parseInt(time);
    }).sort(compareNumbers);
    console.log('No. events:', sum); // 4506
    console.log('Deltas dividends:', deltas.map(function(time) {
      return time / deltas[0];
    }));
    console.log('Smallest Delta:', deltas[0], 'ms / ', deltas[0] / 1000 , 's');
    console.log('Number of intervals with "n" events:', numEventsPerInterval)
  }

  var playbackSocket = function(cb) {
    var rxSocket = Rx.DOM.fromWebSocket(
      'ws://localhost:9000'
    ).map(function(json) {
      return JSON.parse(json.data);
    }).share();

    // rxSocket.subscribe(function(tick) {
    //   console.log(tick);
    // })

    var clock = rxSocket.filter(function(data) {
      return data.type === 'tick';
    }).map(function(data) {
      return data.data;
    });


    var scans = rxSocket.filter(function(data) {
      return data.type === 'scan';
    }).map(function(data) {
      return data.data;
    });

    cb(clock, scans);
  }

  return {
    eventTimeStamp: EVENT_DATE + START_MINUTES * 60 * 1000
  , users: users
  , pauser: pauser
  , getRandomInt: getRandomInt
  , playback: playbackRandom
  // , playback: playbackSocket
  // , playback: playbackScans
  }
})(d3, Rx);