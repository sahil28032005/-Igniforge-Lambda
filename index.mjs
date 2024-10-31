//lambda v6 updated
//after reddis event setup
import { ECSClient, ListTasksCommand, RunTaskCommand, StopTaskCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import Redis from 'ioredis';
import { EC2Client, DescribeNetworkInterfacesCommand } from '@aws-sdk/client-ec2';

// Create Redis client and log connection
const redis = new Redis({
    host: '',
    port:'',
    password: '', // Replace with your actual password
});

//define channel name for event calls
const CHANNEL_NAME = 'container_updates';

// Log Redis connection status
redis.on('connect', () => {
    console.log('Connected to Redis');
});

redis.on('error', (err) => {
    console.error('Redis connection error:', err);
});

const ecsClient = new ECSClient();
const ec2Client = new EC2Client();

const CLUSTER_NAME = 'cloud-manager-cluster';
const IDLE_TASK_COUNT = 3;

// Track container state, allocation status, taskArn, and public IP
const trackContainerState = async (containerId, state, allocated = 'unallocated', taskArn, publicIp) => {
    console.log(`Tracking container state: ${containerId} -> ${state}, allocated: ${allocated}, IP: ${publicIp}`);
    await redis.hset(`container:${containerId}`, 'state', state, 'allocated', allocated, 'taskArn', taskArn, 'publicIp', publicIp);

    //as values updates this msg also broadcasted to connected clients as event notifier using reddis 

    //create publichser message forr identiications such as bridge server will notified when event update occurs
    const message = JSON.stringify({ containerId, state, allocated, taskArn, publicIp });

    await redis.publish(CHANNEL_NAME, message);

    //acknowledgement message
    console.log(`Published update to channel ${CHANNEL_NAME}: ${message}`);
};

// Fetch all container states from Redis
const getContainerStates = async () => {
    console.log('Fetching all container states from Redis');
    return await redis.hgetall('containers');
};

// Fetch public IP of a task after it reaches the "RUNNING" state
const fetchTaskPublicIp = async (taskArn) => {
    let publicIp = 'N/A by fetchTIp';
    let attempts = 10;

    while (attempts > 0) {
        const { tasks } = await ecsClient.send(new DescribeTasksCommand({
            cluster: CLUSTER_NAME,
            tasks: [taskArn],
        }));
        const task = tasks[0];
        const currentStatus = task.lastStatus;

        if (currentStatus === 'RUNNING') {
            publicIp = task.attachments[0]?.details.find(detail => detail.name === 'publicIPv4')?.value || 'N/A';

            //trial approach for ip retrival
            if (publicIp === 'N/A') {
                const eniId = task.attachments[0]?.details.find(detail => detail.name === 'networkInterfaceId')?.value;

                if (eniId) {
                    // Fetch IP from network interface using EC2 DescribeNetworkInterfaces
                    const { NetworkInterfaces } = await ec2Client.send(new DescribeNetworkInterfacesCommand({
                        NetworkInterfaceIds: [eniId],
                    }));

                    publicIp = NetworkInterfaces[0]?.Association?.PublicIp || 'N/A';
                }
            }

            if (publicIp !== 'N/A') {
                await trackContainerState('1234', currentStatus, 'unallocated', 'ppp', 'breaker');
                break;
            };
            await trackContainerState('1234', currentStatus, 'unallocated', 'ppp', 'non breaker');
        }

        // await trackContainerState('1234', currentStatus, 'unallocated', 'ppp', 'ng');

        attempts--;
        await new Promise(r => setTimeout(r, 5000)); // Wait 5 seconds before retrying
    }

    return publicIp;
};

// Stop idle containers based on Redis allocation status
const stopIdleContainers = async () => {
    console.log('Checking for idle containers to stop');
    const containerStates = await getContainerStates();

    for (const [id, state] of Object.entries(containerStates)) {
        if (state === 'idle') {
            console.log(`Stopping idle container: ${id}`);
            const stopTaskCommand = new StopTaskCommand({
                cluster: CLUSTER_NAME,
                task: id,
                reason: 'Stopping idle container',
            });
            await ecsClient.send(stopTaskCommand);
            await trackContainerState(id, 'stopped', 'allocated', id);
        }
    }
};

// Ensure minimum idle tasks are running in the ECS cluster
const runNewTasks = async () => {
    console.log('Listing currently running tasks');
    const listTasksCommand = new ListTasksCommand({
        cluster: CLUSTER_NAME,
        desiredStatus: 'RUNNING',
    });
    const { taskArns } = await ecsClient.send(listTasksCommand);
    console.log(`Found ${taskArns.length} running tasks`);

    const idleTaskCount = IDLE_TASK_COUNT - taskArns.length;
    if (idleTaskCount > 0) {
        console.log(`Starting ${idleTaskCount} new idle tasks to maintain minimum count`);
        for (let i = 0; i < idleTaskCount; i++) {
            const runTaskCommand = new RunTaskCommand({
                cluster: CLUSTER_NAME,
                taskDefinition: 'sahil-sadekar-java-server:14',
                count: 1,
                launchType: 'FARGATE',
                networkConfiguration: {
                    awsvpcConfiguration: {
                        subnets: ['subnet-0e0c97b6f83bfc538', 'subnet-08a60214836f38b79'],
                        securityGroups: ['sg-0bf9e7e682e1bed1a'],
                        assignPublicIp: 'ENABLED',
                    },
                },
            });
            const { tasks } = await ecsClient.send(runTaskCommand);
            const newTaskArn = tasks[0].taskArn;
            const taskId = newTaskArn.split('/').pop();
            console.log(`Started new task: ${newTaskArn}`);

            // Wait a few seconds to allow the task to reach a stable state
            await new Promise(r => setTimeout(r, 5000)); // Wait 5 seconds before fetching IP

            // Fetch and store public IP once the task is running
            const publicIp = 'will come by handler...';

            // Store task state and public IP in Redis
            await trackContainerState(taskId, 'RUNNING', 'unallocated', newTaskArn, publicIp);
        }
    } else {
        console.log('No additional tasks needed to reach the idle count');
    }
};

// Event handler to track container state and manage idle containers
export const handler = async (event) => {
    console.log('Received event:', JSON.stringify(event, null, 2));

    // Parse task details from the event if available
    const taskDetails = event.detail;
    const taskId = taskDetails?.taskArn ? taskDetails.taskArn.split('/').pop() : null;
    const desiredStatus = taskDetails?.desiredStatus || 'UNKNOWN';
    //default is running desired status

    //according to aasumption this will not trigger at first call as well as any call instead of event occurs for task
    if (taskId) {
        try {
            // Default allocation status
            const allocationStatus = 'unallocated';
            let publicIp = 'N/A from cw event';

            // Check if the container's actual current status is 'RUNNING'
            if (taskDetails.lastStatus === 'RUNNING') {
                // Fetch the public IP only if the task is confirmed to be running
                await trackContainerState(taskId, taskDetails.lastStatus, allocationStatus, taskDetails.taskArn, 'going to allocate...');
                publicIp = await fetchTaskPublicIp(taskDetails.taskArn);
            }

            // Update container state and IP in Redis
            await trackContainerState(taskId, taskDetails.lastStatus, allocationStatus, taskDetails.taskArn, publicIp);
            console.log(`Updated Redis: Container ${taskId} is now ${taskDetails.lastStatus}, allocation status: ${allocationStatus}, IP: ${publicIp}`);
        } catch (err) {
            console.error('Error updating Redis:', err);
        }
    } else {
        console.error('No taskArn found in event details');
    }


    console.log('Executing container management handler');
    await stopIdleContainers();
    await runNewTasks();

    console.log('Container management executed successfully');
    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'Container management executed successfully',
        }),
    };
};



// import { ECSClient, ListTasksCommand, RunTaskCommand, StopTaskCommand } from '@aws-sdk/client-ecs';
// import Redis from 'ioredis';

// // Create Redis client and log connection
// const redis = new Redis({
//     host: '',
//     port: '',
//     password: '',
// });

// // Log Redis connection status
// redis.on('connect', () => {
//     console.log('Connected to Redis');
// });

// redis.on('error', (err) => {
//     console.error('Redis connection error:', err);
// });

// const ecsClient = new ECSClient();

// const CLUSTER_NAME = 'cloud-manager-cluster';
// const IDLE_TASK_COUNT = 5;

// const trackContainerState = async (containerId, state) => {
//     console.log(`Tracking container state: ${containerId} -> ${state}`);
//     await redis.hset('containers', containerId, state);
// };

// const getContainerStates = async () => {
//     console.log('Fetching all container states from Redis');
//     return await redis.hgetall('containers');
// };

// const stopIdleContainers = async () => {
//     console.log('Checking for idle containers to stop');
//     const containerStates = await getContainerStates();

//     for (const [id, state] of Object.entries(containerStates)) {
//         if (state === 'idle') {
//             console.log(`Stopping idle container: ${id}`);
//             const stopTaskCommand = new StopTaskCommand({
//                 cluster: 'cloud-manager-cluster',
//                 task: id,
//                 reason: 'Stopping idle container',
//             });
//             await ecsClient.send(stopTaskCommand);
//             await trackContainerState(id, 'stopped');
//         }
//     }
// };

// const runNewTasks = async () => {
//     console.log('Listing currently running tasks');
//     const listTasksCommand = new ListTasksCommand({
//         cluster: 'cloud-manager-cluster',
//         desiredStatus: 'RUNNING',
//     });
//     const { taskArns } = await ecsClient.send(listTasksCommand);
//     console.log(`Found ${taskArns.length} running tasks`);

//     for (const taskArn of taskArns) {
//         await trackContainerState(taskArn, 'running');
//     }

//     const idleTaskCount = IDLE_TASK_COUNT - taskArns.length;
//     if (idleTaskCount > 0) {
//         console.log(`Starting ${idleTaskCount} new idle tasks to maintain minimum count`);
//         for (let i = 0; i < idleTaskCount; i++) {
//             const runTaskCommand = new RunTaskCommand({
//                 cluster: 'cloud-manager-cluster',
//                 taskDefinition: 'sahil-sadekar-java-server:14',
//                 count: 1,
//                 launchType: 'FARGATE',
//                 networkConfiguration: {
//                     awsvpcConfiguration: {
//                         subnets: ['subnet-0e0c97b6f83bfc538', 'subnet-08a60214836f38b79'],
//                         securityGroups: ['sg-0bf9e7e682e1bed1a'],
//                         assignPublicIp: 'ENABLED',
//                     },
//                 },
//             });
//             const { tasks } = await ecsClient.send(runTaskCommand);
//             console.log(`Started new task: ${tasks[0].taskArn}`);
//             await trackContainerState(tasks[0].taskArn, 'running');
//         }
//     } else {
//         console.log('No additional tasks needed to reach the idle count');
//     }
// };

// export const handler = async () => {
//     console.log('Executing container management handler');
//     await stopIdleContainers();
//     await runNewTasks();

//     console.log('Container management executed successfully');
//     return {
//         statusCode: 200,
//         body: JSON.stringify({
//             message: 'Container management executed successfully',
//         }),
//     };
// };


// lambda v2
// import { ECSClient, ListTasksCommand, RunTaskCommand, StopTaskCommand } from '@aws-sdk/client-ecs';
// import Redis from 'ioredis';

// // Create Redis client and log connection
// const redis = new Redis({
//     host: '',
//     port: 16822,
//     password: '', // Replace with your actual password
// });

// // Log Redis connection status
// redis.on('connect', () => {
//     console.log('Connected to Redis');
// });

// redis.on('error', (err) => {
//     console.error('Redis connection error:', err);
// });

// const ecsClient = new ECSClient();

// const CLUSTER_NAME = 'cloud-manager-cluster';
// const IDLE_TASK_COUNT = 5;

// // Track container state and allocation status
// const trackContainerState = async (containerId, state, allocated = 'unallocated') => {
//     console.log(`Tracking container state: ${containerId} -> ${state}, allocated: ${allocated}`);
//     await redis.hset(`container:${containerId}`, 'state', state, 'allocated', allocated);
// };

// // Fetch all container states from Redis
// const getContainerStates = async () => {
//     console.log('Fetching all container states from Redis');
//     return await redis.hgetall('containers');
// };

// // Stop idle containers based on Redis allocation status
// const stopIdleContainers = async () => {
//     console.log('Checking for idle containers to stop');
//     const containerStates = await getContainerStates();

//     for (const [id, state] of Object.entries(containerStates)) {
//         if (state === 'idle') {
//             console.log(`Stopping idle container: ${id}`);
//             const stopTaskCommand = new StopTaskCommand({
//                 cluster: CLUSTER_NAME,
//                 task: id,
//                 reason: 'Stopping idle container',
//             });
//             await ecsClient.send(stopTaskCommand);
//             await trackContainerState(id, 'stopped');
//         }
//     }
// };

// // Ensure minimum idle tasks are running in the ECS cluster
// const runNewTasks = async () => {
//     console.log('Listing currently running tasks');
//     const listTasksCommand = new ListTasksCommand({
//         cluster: CLUSTER_NAME,
//         desiredStatus: 'RUNNING',
//     });
//     const { taskArns } = await ecsClient.send(listTasksCommand);
//     console.log(`Found ${taskArns.length} running tasks`);

//     for (const taskArn of taskArns) {
//         await trackContainerState(taskArn, 'running', 'unallocated'); // Default 'unallocated' for running tasks
//     }

//     const idleTaskCount = IDLE_TASK_COUNT - taskArns.length;
//     if (idleTaskCount > 0) {
//         console.log(`Starting ${idleTaskCount} new idle tasks to maintain minimum count`);
//         for (let i = 0; i < idleTaskCount; i++) {
//             const runTaskCommand = new RunTaskCommand({
//                 cluster: CLUSTER_NAME,
//                 taskDefinition: 'sahil-sadekar-java-server:14',
//                 count: 1,
//                 launchType: 'FARGATE',
//                 networkConfiguration: {
//                     awsvpcConfiguration: {
//                         subnets: ['subnet-0e0c97b6f83bfc538', 'subnet-08a60214836f38b79'],
//                         securityGroups: ['sg-0bf9e7e682e1bed1a'],
//                         assignPublicIp: 'ENABLED',
//                     },
//                 },
//             });
//             const { tasks } = await ecsClient.send(runTaskCommand);
//             console.log(`Started new task: ${tasks[0].taskArn}`);
//             await trackContainerState(tasks[0].taskArn, 'running', 'unallocated');
//         }
//     } else {
//         console.log('No additional tasks needed to reach the idle count');
//     }
// };

// // Event handler to track container state and manage idle containers
// export const handler = async (event) => {
//     console.log('Received event:', JSON.stringify(event, null, 2));

//     // Parse task details from the event if available
//     const taskDetails = event.detail;
//     const taskId = taskDetails?.taskArn ? taskDetails.taskArn.split('/').pop() : null;
//     const desiredStatus = taskDetails?.desiredStatus || 'UNKNOWN';

//     if (taskId) {
//         try {
//             // Update Redis with the container's current state and default allocation status as 'unallocated'
//             const allocationStatus = desiredStatus === 'running' ? 'unallocated' : 'allocated';
//             await trackContainerState(taskId, desiredStatus, allocationStatus);
//             console.log(`Updated Redis: Container ${taskId} is now ${desiredStatus} and ${allocationStatus}`);
//         } catch (err) {
//             console.error('Error updating Redis:', err);
//         }
//     } else {
//         console.error('No taskArn found in event details');
//     }

//     console.log('Executing container management handler');
//     await stopIdleContainers();
//     await runNewTasks();

//     console.log('Container management executed successfully');
//     return {
//         statusCode: 200,
//         body: JSON.stringify({
//             message: 'Container management executed successfully',
//         }),
//     };
// };

//lambda v3
import { ECSClient, ListTasksCommand, RunTaskCommand, StopTaskCommand,DescribeTasksCommand  } from '@aws-sdk/client-ecs';
import Redis from 'ioredis';

// Create Redis client and log connection
const redis = new Redis({
    host: '',
    port: '',
    password: '', // Replace with your actual password
});

// Log Redis connection status
redis.on('connect', () => {
    console.log('Connected to Redis');
});

redis.on('error', (err) => {
    console.error('Redis connection error:', err);
});

const ecsClient = new ECSClient();

const CLUSTER_NAME = 'cloud-manager-cluster';
const IDLE_TASK_COUNT = 3;

// Track container state, allocation status, and taskArn
const trackContainerState = async (containerId, state, allocated = 'unallocated', taskArn) => {
    console.log(`Tracking container state: ${containerId} -> ${state}, allocated: ${allocated}`);
    await redis.hset(`container:${containerId}`, 'state', state, 'allocated', allocated, 'taskArn', taskArn);
};

// Fetch all container states from Redis
const getContainerStates = async () => {
    console.log('Fetching all container states from Redis');
    return await redis.hgetall('containers');
};

// Stop idle containers based on Redis allocation status
const stopIdleContainers = async () => {
    console.log('Checking for idle containers to stop');
    const containerStates = await getContainerStates();

    for (const [id, state] of Object.entries(containerStates)) {
        if (state === 'idle') {
            console.log(`Stopping idle container: ${id}`);
            const stopTaskCommand = new StopTaskCommand({
                cluster: CLUSTER_NAME,
                task: id,
                reason: 'Stopping idle container',
            });
            await ecsClient.send(stopTaskCommand);
            await trackContainerState(id, 'stopped', 'allocated', id);
        }
    }
};

// Ensure minimum idle tasks are running in the ECS cluster
const runNewTasks = async () => {
    console.log('Listing currently running tasks');
    const listTasksCommand = new ListTasksCommand({
        cluster: CLUSTER_NAME,
        desiredStatus: 'RUNNING',
    });
    const { taskArns } = await ecsClient.send(listTasksCommand);
    console.log(`Found ${taskArns.length} running tasks`);

    // for (const taskArn of taskArns) {
    //     await trackContainerState(taskArn.split('/').pop(), 'running', 'unallocated', taskArn); // Default 'unallocated' for running tasks
    // }

    const idleTaskCount = IDLE_TASK_COUNT - taskArns.length;
    if (idleTaskCount > 0) {
        console.log(`Starting ${idleTaskCount} new idle tasks to maintain minimum count`);
        for (let i = 0; i < idleTaskCount; i++) {
            const runTaskCommand = new RunTaskCommand({
                cluster: CLUSTER_NAME,
                taskDefinition: 'sahil-sadekar-java-server:14',
                count: 1,
                launchType: 'FARGATE',
                networkConfiguration: {
                    awsvpcConfiguration: {
                        subnets: ['subnet-0e0c97b6f83bfc538', 'subnet-08a60214836f38b79'],
                        securityGroups: ['sg-0bf9e7e682e1bed1a'],
                        assignPublicIp: 'ENABLED',
                    },
                },
            });
            const { tasks } = await ecsClient.send(runTaskCommand);
            const newTaskArn = tasks[0].taskArn;
            const taskId = newTaskArn.split('/').pop();
            console.log(`Started new task: ${newTaskArn}`);

            //get current task details actual at their runtime as their last state
             // Fetch the current task status
             const describeTasksCommand = new DescribeTasksCommand({
                cluster: CLUSTER_NAME,
                tasks: [newTaskArn],
            });
            const { tasks: describedTasks } = await ecsClient.send(describeTasksCommand);
            const currentStatus = describedTasks[0].lastStatus;  // Get the initial status, e.g., 'PROVISIONING'
            await trackContainerState(taskId, currentStatus, 'unallocated', newTaskArn);
        }
    } else {
        console.log('No additional tasks needed to reach the idle count');
    }
};

// Event handler to track container state and manage idle containers
export const handler = async (event) => {
    console.log('Received event:', JSON.stringify(event, null, 2));

    // Parse task details from the event if available
    const taskDetails = event.detail;
    const taskId = taskDetails?.taskArn ? taskDetails.taskArn.split('/').pop() : null;
    const desiredStatus = taskDetails?.desiredStatus || 'UNKNOWN';
    //default is running desired status

    //according to aasumption this will not trigger at first call as well as any call instead of event occurs for task

    if (taskId) {
        try {
            // Update Redis with the container's current state and default allocation status as 'unallocated'
            const allocationStatus = 'unallocated';
            await trackContainerState(taskId, desiredStatus, allocationStatus, taskDetails.taskArn);
            console.log(`Updated Redis: Container ${taskId} is now ${desiredStatus} and ${allocationStatus}`);
        } catch (err) {
            console.error('Error updating Redis:', err);
        }
    } else {
        console.error('No taskArn found in event details');
    }

    console.log('Executing container management handler');
    await stopIdleContainers();
    await runNewTasks();

    console.log('Container management executed successfully');
    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'Container management executed successfully',
        }),
    };
};
