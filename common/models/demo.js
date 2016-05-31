// Licensed under the Apache License. See footer for details.
var helper = require("./helper.js");
var async = require("async");
var bcrypt = require("bcryptjs");
var randomstring = require("randomstring");
var fs = require('fs');

function makeUniqueSession(demo) {
  var SALT_WORK_FACTOR = 10;
  var salt = bcrypt.genSaltSync(SALT_WORK_FACTOR);
  return new Buffer(bcrypt.hashSync(demo.id + " " + demo.createdAt, salt)).toString('base64');
}

module.exports = function (Demo) {
  helper.hideAll(Demo);
  helper.hideRelation(Demo, "users");

  function seed(model, callback) {
    console.log("Seeding", model.definition.name);
    model.count(function (err, count) {
      if (err) {
        console.log(err);
        callback(null);
      } else if (count == 0) {
        var objects = JSON.parse(fs.readFileSync("./seed/" + model.definition.name.toLowerCase() + ".json"));
        console.log("Injecting", objects.length, model.definition.name);
        model.create(objects, function (err, records) {
          if (err) {
            console.log("Failed to create", model.definition.name, err);
          } else {
            console.log("Created", records.length, model.definition.name);
          }
          callback(null);
        });
      } else {
        console.log("There are already", count, model.definition.name);
        callback(null);
      }
    });
  };

  Demo.seed = function (cb) {
    console.log("Seeding...");
    async.waterfall(
        [ //
          Demo.app.models.Supplier,
          Demo.app.models.Product,
          Demo.app.models.DistributionCenter,
          Demo.app.models.Inventory,
          Demo.app.models.Retailer,
          Demo.app.models.Shipment,
          Demo.app.models.LineItem,
        ].map(function (model) {
        return function (callback) {
          seed(model, callback);
        };
      }),
      function (err, result) {
        if (err) {
          console.log(err);
        } else {
          console.log("Inject complete");
        }
        cb(err);
      });
  };

  Demo.remoteMethod('seed', {
    description: 'Injects sample data in the service',
    http: {
      path: '/seed',
      verb: 'post'
    },
    accepts: []
  });

  Demo.reset = function (cb) {
    async.waterfall([
      Demo.app.models.Supplier,
      Demo.app.models.Product,
      Demo.app.models.DistributionCenter,
      Demo.app.models.Inventory,
      Demo.app.models.Retailer,
      Demo.app.models.Shipment,
      Demo.app.models.LineItem,
      Demo.app.models.Demo,
      Demo.app.models.ERPUser
    ].map(function (model) {
        return function (callback) {
          console.log("Deleting all", model.definition.name);
          model.destroyAll(function (err, result) {
            callback(err);
          });
        };
      }),
      function (err, result) {
        if (err) {
          console.log(err);
        } else {
          console.log("Reset complete");
        }
        cb(err);
      });
  };

  Demo.remoteMethod('reset', {
    description: 'Resets the demo data',
    http: {
      path: '/reset',
      verb: 'post'
    },
    accepts: []
  });

  Demo.newDemo = function (data, cb) {

    var app = Demo.app;

    async.waterfall([
      // create a new demo environment
      function (callback) {
        Demo.create({
          name: data.name
        }, function (err, demo) {
          callback(err, demo);
        });
      },
      // make a unique guid for the demo environment
      function (demo, callback) {
        demo.guid = makeUniqueSession(demo);
        Demo.upsert(demo, function (err, demo) {
          callback(err, demo);
        });
      },
      // create the supply chain manager
      function (demo, callback) {
        var random = randomstring.generate(10)
        var supplyChainManager = {
          email: "chris." + random + "@acme.com",
          username: "Supply Chain Manager (" + random + ")",
          password: randomstring.generate(10),
          demoId: demo.id
        }

        app.models.ERPUser.create(supplyChainManager, function (err, user) {
          callback(err, demo, user);
        });
      },
      // assign roles to the users
      function (demo, user, callback) {
        Demo.app.models.ERPUser.assignRole(user,
          Demo.app.models.ERPUser.SUPPLY_CHAIN_MANAGER_ROLE,
          function (err, principal) {
            callback(err, demo)
          });
      },
      // returns the demo, its users and the roles
      function (demo, callback) {
        Demo.findById(demo.id, {
            include: {
              relation: 'users',
              scope: {
                include: {
                  relation: 'roles'
                }
              }
            }
          },
          function (err, demo) {
            callback(err, demo);
          });
        // insert default shipments and inventories
      }
    ], function (err, result) {
      cb(err, result);
    });
  };

  Demo.remoteMethod('newDemo', {
    description: 'Creates a new Demo environment',
    http: {
      path: '/',
      verb: 'post'
    },
    accepts: [
      {
        arg: 'data',
        type: 'Demo',
        http: {
          source: 'body'
        }
      }
    ],
    returns: {
      arg: "demo",
      type: "Demo",
      root: true
    }
  });

  Demo.findByGuid = function (guid, cb) {
    Demo.findOne({
        where: {
          guid: guid
        },
        include: {
          relation: 'users',
          scope: {
            include: {
              relation: 'roles'
            }
          }
        }
      },
      function (err, demo) {
        if (!err && !demo) {
          var notFound = new Error("No Demo with this guid");
          notFound.status = 404
          cb(notFound);
        } else {
          cb(err, demo);
        }
      });
  };

  Demo.remoteMethod('findByGuid', {
    description: 'Retrieves the Demo environment with the given guid',
    http: {
      path: '/findByGuid/:guid',
      verb: 'get'
    },
    accepts: [
      {
        arg: "guid",
        type: "string",
        required: true,
        http: {
          source: "path"
        }
      }
    ],
    returns: {
      arg: "demo",
      type: "Demo",
      root: true
    }
  });

  Demo.retailers = function (guid, cb) {
    async.waterfall([
      // retrieve the demo
      function (callback) {
        Demo.findOne({
          where: {
            guid: guid
          }
        }, function (err, demo) {
          if (!err && !demo) {
            var notFound = new Error("No Demo with this guid");
            notFound.status = 404
            callback(notFound);
          } else {
            callback(err);
          }
        });
      },
      // retrieve the user linked to this demo
      function (callback) {
        Demo.app.models.Retailer.find(function (err, retailers) {
          callback(err, retailers);
        });
      }
    ], function (err, retailers) {
      cb(err, retailers);
    });
  };

  Demo.remoteMethod('retailers', {
    description: 'Returns all retailers',
    http: {
      path: '/:guid/retailers',
      verb: 'get'
    },
    accepts: [
      {
        arg: "guid",
        type: "string",
        required: true,
        http: {
          source: "path"
        }
      }
    ],
    returns: {
      arg: "retailers",
      type: ["Retailer"],
      root: true
    }
  });

  Demo.loginAs = function (guid, userId, cb) {
    async.waterfall([
      // retrieve the demo
      function (callback) {
        Demo.findOne({
          where: {
            guid: guid
          }
        }, function (err, demo) {
          if (!err && !demo) {
            var notFound = new Error("No Demo with this guid");
            notFound.status = 404;
            callback(notFound);
          } else {
            callback(err, demo);
          }
        });
      },
      // retrieve the user linked to this demo
      function (demo, callback) {
        Demo.app.models.ERPUser.findOne({
          where: {
            id: userId,
            demoId: demo.id
          }
        }, function (err, user) {
          if (!err && !user) {
            var userNotFound = new Error("No user with this id");
            userNotFound.status = 404;
            callback(userNotFound);
          } else {
            callback(err, user);
          }
        });
      },
      // issue a token for this user
      function (user, callback) {
        user.createAccessToken(Demo.app.models.User.DEFAULT_TTL, function (err, token) {
          callback(err, token);
        });
      }
    ], function (err, token) {
      cb(err, token);
    });
  };

  Demo.remoteMethod('loginAs', {
    description: 'Logs in as the specified user belonging to the given demo environment',
    http: {
      path: '/:guid/loginAs',
      verb: 'post'
    },
    accepts: [
      {
        arg: "guid",
        type: "string",
        required: true,
        http: {
          source: "path"
        }
      },
      {
        arg: "userId",
        type: "string",
        required: true
      }
    ],
    returns: {
      arg: "token",
      type: "AccessToken",
      root: true
    }
  });

  // Delete users associated to a demo environment
  Demo.observe("after delete", function (context, next) {
    console.log("Deleting users linked to demo", context.where.id);
    Demo.app.models.ERPUser.find({
      where: {
        demoId: context.where.id
      }
    }, function (err, users) {
      if (err) {
        next(err);
      } else if (users.length == 0) {
        next();
      } else {
        async.waterfall(users.map(function (user) {
          return function (callback) {
            console.log("Deleting user", user.email);
            user.destroy(function () {
              callback();
            });
          }
        }), function (err, result) {
          next();
        });
      }
    });
  });

  Demo.deleteByGuid = function (guid, cb) {
    console.log("Deleting demo with guid", guid);
    async.waterfall([
      // retrieve the demo
      function (callback) {
          Demo.findOne({
            where: {
              guid: guid
            }
          }, function (err, demo) {
            if (!err && !demo) {
              var notFound = new Error("No Demo with this guid");
              notFound.status = 404
              callback(notFound);
            } else {
              callback(err, demo);
            }
          });
      },
      // delete the demo
      function (demo, callback) {
          Demo.destroyById(demo.id,
            function (err, info) {
              console.log("Deleted demo", demo.id);
              callback(err, demo);
            });
      }
    ],
      function (err, result) {
        cb(err);
      });
  };

  Demo.remoteMethod('deleteByGuid', {
    description: 'Deletes the given demo environment',
    http: {
      path: '/:guid',
      verb: 'delete'
    },
    accepts: [
      {
        arg: "guid",
        type: "string",
        required: true,
        http: {
          source: "path"
        }
      }
    ]
  });

  Demo.createUserByGuid = function (guid, retailerId, cb) {
    console.log("Adding new Retail Store Manager to demo with guid", guid, retailerId);

    var app = Demo.app;

    async.waterfall([
      // retrieve the demo
      function (callback) {
          Demo.findOne({
            where: {
              guid: guid
            }
          }, function (err, demo) {
            if (!err && !demo) {
              var notFound = new Error("No Demo with this guid");
              notFound.status = 404;
              callback(notFound);
            } else {
              callback(err, demo);
            }
          });
      },
      // retrieve the store
      function (demo, callback) {
          app.models.Retailer.findById(retailerId, function (err, retailer) {
            if (!err && !retailer) {
              var notFound = new Error("No retailer with this id");
              notFound.status = 404
              callback(notFound);
            } else {
              // check that the store demoId is the same as the user demoId
              if (retailer.demoId && retailer.demoId != demo.id) {
                // can't assign a manager from another demo with this one
                var invalidDemoId = new Error("Demo id does not match the one from the retail store");
                invalidDemoId.status = 400;
                callback(invalidDemoId);
              } else {
                callback(err, demo, retailer);
              }
            }
          });
      },
      // create the user
      function (demo, retailer, callback) {
          var random = randomstring.generate(10)
          var retailStoreManager = {
            email: "ruth." + random + "@acme.com",
            username: "Retail Store Manager (" + random + ")",
            password: randomstring.generate(10),
            demoId: demo.id
          }

          app.models.ERPUser.create(retailStoreManager, function (err, user) {
            callback(err, demo, retailer, user);
          });
      },
      // assign Retail manager role to the user
      function (demo, retailer, user, callback) {
          Demo.app.models.ERPUser.assignRole(user,
            Demo.app.models.ERPUser.RETAIL_STORE_MANAGER_ROLE,
            function (err, principal) {
              callback(err, retailer, user)
            });
      },
      // assign the user as manager for the store
      function (retailer, user, callback) {
          retailer.managerId = user.id
          retailer.save(function (err, updated) {
            callback(err, user);
          });
      }
    ],
      function (err, user) {
        cb(err, user);
      });
  };

  Demo.remoteMethod('createUserByGuid', {
    description: 'Adds a new Retail Store manager to the given demo environment',
    http: {
      path: '/:guid/createUser',
      verb: 'post'
    },
    accepts: [
      {
        arg: "guid",
        type: "string",
        required: true,
        http: {
          source: "path"
        }
      },
      {
        arg: "retailerId",
        type: "string",
        required: true
      }
    ],
    returns: {
      arg: "user",
      type: "ERPUser",
      root: true
    }
  });

};
//------------------------------------------------------------------------------
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//------------------------------------------------------------------------------
