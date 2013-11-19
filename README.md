ec2-sysadmin
============

Scripts to manage ec2 instances


## manageInstance.js

I use this script to start and stop my EC2 development server without using elastic IP addresses. The script starts the EC2 instance,
waits until it is running, extracts the hostname of the new instance, and then updates a Route53 record so that
my "dev.server.com" domain points at it. It also stops the instance when I'm done with it. 

This way, I only need to pay for this instance when I'm actually using it, and I only need to run a single command to get it going. 


## Installation

In manageInstance.js, set the instanceId, zoneId, cname variables with your own values from the AWS admin console. Make sure your IAM user creds 
are set in the shell environment, and that the IAM user has the appropriate privileges to start/stop this instance and update
Route53 records. Then:

	npm --install
	node manageInstance.js 
