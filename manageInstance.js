#!/usr/local/bin/node
// start/stop EC2 instance
// and set DNS up to point at newly started instance


// enter EC2 instance ID here

var instanceId = 'i-xxxxxxxx';

// Route 53 Zone ID and CNAME to update to point towards our instance
var zoneId = 'XXXXXXXXXXXXXX'; 
var cname = "aaa.example.com";

// takes credentials from environment 
// IAM user must have privileges to start/stop instances, update DNS records 

var AWS = require('aws-sdk');
AWS.config.update({region: 'eu-west-1', sslEnabled:true});
var ec2 = new AWS.EC2();

var optimist = require('optimist').usage('$0 --start | --stop');
var argv = optimist.argv;


if(argv.start){
	// user requested to start server
	
	var route53 = new AWS.Route53();
	
	startServer(ec2, route53, instanceId, zoneId, function(err,data){
		if(err){
			console.error("Failed to start: " + err);
		}
		else{
			console.log("Successful start: " + data);
		}
		
	});
}
else if(argv.stop){
	// user requested to stop server	
	stopServer(ec2, instanceId, function(err,data){
		if(err){
			console.error("Failed to stop: " + err);
		}
		else{
			console.log("Successful stop: " + data);
		}
		
	});
	
}
else{
	// just show status
	getStatus(ec2, instanceId, function(err, data){
		if(err){
			console.error("Failed to get status: " + err);
		}
		else{
			optimist.showHelp();
			console.log("Server status: " + data.State.Name);

		}	
	});	
}






function getStatus(ec2, instanceId, callback){
	ec2.describeInstances({InstanceIds:[instanceId]}, function(err, data){
		if(err){
			callback("describeInstances error: " + err);
		}
		else{
			instance = data.Reservations[0].Instances[0];
			if(instance.InstanceId != instanceId){
				callback("Got incorrect instance back: " + instance.InstanceId);				
			}
			// console.info(data.Reservations[0].Instances[0]);

			// returns Instance.
			callback(null, data.Reservations[0].Instances[0]);
		}	
	});
}

function startServer(ec2, route53, instanceId, zoneId, callback){	
	var dns = require('dns');
		
	
	// first check it's in the stopped mode
	getStatus(ec2, instanceId, function(err, data){
		if(err){
			callback("Failed to get status: " + err);
		}
		else{
			if (data.State.Name != "stopped"){
				callback("Can't start server, current status: " + data.State.Name);
			}
			else{
				// ok, it's currently stopped, attempt start.
				console.log("Attempting to start server...");
				ec2.startInstances({InstanceIds:[instanceId]}, function(err, data){
					if(err){
						callback("startInstances failed: " + err);
					}
					else{
						instance = data.StartingInstances[0];
						if(instance.InstanceId != instanceId){
							callback("Got incorrect instance back: " + instance.InstanceId);						
						}
						else{
							// status is probably Pending now. 
							
							// wait until it's not pending (check every 10 secs.)
							waitForStatusChange(ec2, instanceId, 'pending', 10*1000, function(err, data){
								if(err){
									callback("failed to wait for status: " + err);									
								}
								else{
									if(data.State.Name != "running"){
										callback("Status changed to " + data.State.Name + ", bailing");										
									}
									else{
										console.log("Server runnning, attempting DNS update...")
										domain = data.PublicDnsName + ".";
										
										dns.resolveCname(cname, function(err, addresses){
											if (err || ! addresses.length){
												// assume this means no existing cname
												route53params= {											
													HostedZoneId:zoneId, 
													ChangeBatch:{
														Changes:[
															{
																Action: 'CREATE',
																ResourceRecordSet: {
																	Name: cname,
																	Type: "CNAME",
																	TTL: 60,
																	ResourceRecords:[
																	{Value: domain},
																	]															
																}														
															},
														]
													}												
												};
											}
											else{
												// we have a cname
												route53params= {											
													HostedZoneId:zoneId, 
													ChangeBatch:{
														Changes:[
															{
																Action: 'DELETE',
																ResourceRecordSet: {
																	Name: cname,
																	Type: "CNAME",
																	TTL: 60,
																	ResourceRecords:[
																	{Value: addresses[0] + "."}, // existing cname value
																	]															
																	
																}												
															},
															{
																Action: 'CREATE',
																ResourceRecordSet: {
																	Name: cname,
																	Type: "CNAME",
																	TTL: 60,
																	ResourceRecords:[
																	{Value: domain},
																	]															
																}														
															},
														]
													}};
											}
											

											route53.changeResourceRecordSets(
												route53params,
												function(err, data){
													if(err){
														callback("DNS update failed: " + err);
													}
													else{
														console.log("DNS update requested, waiting for sync...");
														changeId = data.ChangeInfo.Id;														

														// check every 15secs to see if change has committed
														waitForDNSChange(route53, changeId, 'PENDING', 15 * 1000, function(err, data){
															if(err){
																callback("DNS wait failed: " + err);
															}
															else if(data.ChangeInfo.Status != "INSYNC"){
																callback("Error, DNS change status is " + data.ChangeInfo.Status);															
															}
															else{
																// console.dir(data);
																callback(null, "Success! Server running and and DNS change INSYNC.")
															}															
														});
													}

												});
										});
										


									}


									
								}
								
								
							});
							
						}
					}
				});				
			}				
		}	
	});	
	
	
	
}


function stopServer(ec2, instanceId, callback){
	// first check it's in the running mode
	getStatus(ec2, instanceId, function(err, data){
		if(err){
			callback("Failed to get status: " + err);
		}
		else{
			if (data.State.Name != "running"){
				callback("Can't stop server, current status: " + data.State.Name);
			}
			else{
				// ok, it's currently running, attempt stop
				console.log("Attempting to stop server...");
				ec2.stopInstances({InstanceIds:[instanceId]}, function(err, data){
					if(err){
						callback("StopInstances failed: " + err);
					}
					else{
						instance = data.StoppingInstances[0];
						if(instance.InstanceId != instanceId){
							callback("Got incorrect instance back: " + instance.InstanceId);						
						}
						else{
							// status is probably Pending now. 
							
							// wait until it's not pending (check every 10 secs.)
							waitForStatusChange(ec2, instanceId, 'stopping', 10*1000, function(err, data){
								if(err){
									callback("failed to wait for status: " + err);									
								}
								else{
									if(data.State.Name != "stopped"){
										callback("Status changed to " + data.State.Name + ", bailing");										
									}
									else{
										callback(null, "Server successfully stopped.")
									}
								}
							});
						}
					}
				});				
			}
		}
	});
	
}

function waitForStatusChange(ec2, instanceId, status, interval, callback){
	// while status==status, keep polling after waiting interval
	getStatus(ec2, instanceId, function(err, data){
		if(err){
			callback("Failed to get status: " + err);
		}
		else{									

			if(data.State.Name == status){
				console.log("...status is " + data.State.Name + ", waiting...");
				setTimeout(function(){
					waitForStatusChange(ec2, instanceId, status, interval, callback)
				}, interval);
			}
			else{
				callback(null, data);				
			}
		}
	});	
	
}

function waitForDNSChange(route53, changeId, status, interval, callback){
	// while status==status, keep polling after waiting interval
	route53.getChange({Id:changeId}, function(err, data){
		if(err){
			callback("Failed to get DNS change status: " + err);
		}
		else{
			if(data.ChangeInfo.Status == status){
				console.log("...status is " + status + ", waiting...");
				setTimeout(function(){
					waitForDNSChange(route53, changeId, status, interval, callback)
				}, interval);
			}
			else{
				callback(null, data);				
			}
		}
	});	
	
}