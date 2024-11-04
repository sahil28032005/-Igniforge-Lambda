Skip to main content
Stack Overflow
Products
OverflowAI
Search…
Sahil Sadekar's user avatar
Sahil Sadekar
1, 1 reputation
●11 bronze badge
Home
Questions
Tags
Saves
Users
Companies
Labs
Jobs
Discussions
Collectives
Communities for your favorite technologies. Explore all Collectives

Teams
Now available on Stack Overflow for Teams! AI features where you work: search, IDE, and chat.

 
Looking for your Teams?

Socket.io bad request with response {"code":0,"message":"Transport unknown"}?
Asked 10 years, 5 months ago
Modified 1 year, 7 months ago
Viewed 54k times

Report this ad
21

I'm trying to run socket.io and I'm getting a bunch of these:

http://domain.com:8080/socket.io/?EIO=2&transport=polling&t=1401421022966-0 400 (Bad Request) 
This is the response I'm getting:

{"code":0,"message":"Transport unknown"}
I can't find any reason. I read somewhere that it might be misinterpreting the client, but that's about as far as I could get.

javascriptnode.jssocket.iohttp-status-code-400
Share
Edit
Follow
asked May 30, 2014 at 3:44
JVE999's user avatar
JVE999
3,4671212 gold badges6060 silver badges9595 bronze badges
1
It seems like your url is not well formed. Does taking out the slash after socket.io improve your situation? Sooo, it would look like http://domain.com:8080/socket.io?EIO=2&transport=polling&t=1401421022966-0 – 
grobot
 CommentedMay 30, 2014 at 3:59
1
From socket.io's doc, here are socket.io default transports: websocket, htmlfile, xhr-polling, jsonp-polling – 
Ben
 CommentedMay 30, 2014 at 4:29 
@grobot There is nothing malformed about that URL. Slashes are quite common in URL's, even at the end. – 
Brandon
 CommentedJan 3, 2015 at 2:57
Add a comment
7 Answers
Sorted by:

Highest score (default)
21

I had the same issue after upgrading from 0.9.x to 1.x.x. Shortening the long story, I would set transports to ['websocket', 'polling'] and then the error...

when you config your server to use specefic transpors you should set the same config on client side to...

server

    var io = require('socket.io')(server, {'transports': ['websocket', 'polling']});
client

    var io = io( serverUri, {'transports': ['websocket', 'polling']});
Share
Edit
Follow
edited Sep 21, 2014 at 11:26
answered Sep 21, 2014 at 10:55
smbeiragh's user avatar
smbeiragh
71177 silver badges66 bronze badges
2
Where are these files? – 
Csaba Toth
 CommentedFeb 13, 2015 at 18:02
i know this is late, in 2021, but let me thank you. I looked everywhere, and everybody was always solving problems by having matching versions of client and server which I already had. In my case, as soon as i blocked the transport to websocket on the server, i got the bad request error, because client was still trying to use polling! declaring transport on client as well did it! Thanks again! – 
MaX
 CommentedMay 11, 2021 at 10:52
Add a comment
17

I had the same issue,after upgrading from 0.9.x, turns out my server config was set to ['websocket', 'jsonp-polling'] which was valid in 0.9 but the default config for the client and server is now ['polling', 'websocket']. Removing my server config got me up and running.

The config is now documented in engine.io (https://github.com/automattic/engine.io), the new transport layer introduced in 1.0 - in particular this line:
transports ( String): transports to allow connections to (['polling', 'websocket'])

Share
Edit
Follow
answered Jun 8, 2014 at 2:45
johnl's user avatar
johnl
17122 bronze badges
2
Can you enlighten me on where the server config is? I just completely uninstalled the socket.io folder in node_modules and reinstalled and I'm still getting this problem. – 
River Tam
 CommentedJul 11, 2014 at 3:46
This fixed it! Fantastic. @RiverTam The config would be in your code somewhere. – 
Brad
 CommentedDec 3, 2014 at 2:54
1
Where is this config file? – 
Csaba Toth
 CommentedFeb 13, 2015 at 18:02
prntscr.com/g3ekl8 chat is working fine but the newrelic logs this.I also found all logs are from Windows NT 6.1 which may be try to connect using polling any suggestion – 
Max
 CommentedAug 2, 2017 at 12:06
Add a comment
4

i had the same issue:

Getting the latest socket-client.js and using these file on clientside, solved this problem for me.

Share
Edit
Follow
answered Jun 29, 2014 at 19:39
turtec's user avatar
turtec
6122 bronze badges
Using the latest client javascript file fixed this problem for me too: cdn.socket.io/socket.io-1.3.5.js – 
Dave
 CommentedSep 2, 2015 at 4:27 
Add a comment
3

This happened to me when I served the socket.io.js script myself. I had to go copy node_modules/socket.io/node_modules/socket.io-client/socket.io.js to where I was serving it up.

Share
Edit
Follow
answered Sep 17, 2014 at 16:39
Drew LeSueur's user avatar
Drew LeSueur
20k2929 gold badges9191 silver badges107107 bronze badges
Could you elaborate on that? – 
Csaba Toth
 CommentedFeb 13, 2015 at 18:01
This was a while ago, but if I remember right If my page loads on foo.com, but I am connecting to a websocket on bar.com, I had to copy the socket.io.js file onto foo.com and load it from there. I don't know if that solution will still work, or if it's the best way to do it. – 
Drew LeSueur
 CommentedFeb 13, 2015 at 18:34 
Solved my problem! I used an old version in which I loaded a local version instead of directly from the node instance – 
Jos
 CommentedMar 25, 2015 at 16:32 
Add a comment
2

Try this configuration on server side:

const io = require('socket.io')(server, {
    cors: {
        origin: "http://localhost:8100",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true
});
Share
Edit
Follow
edited Mar 14, 2023 at 7:29
Elikill58's user avatar
Elikill58
4,7302727 gold badges3030 silver badges6161 bronze badges
answered Jan 27, 2021 at 12:00
Rohit M's user avatar
Rohit M
47144 silver badges99 bronze badges
Thank you! I had missing allowEIO3: true – 
Adam Bardon
 CommentedMar 9, 2021 at 19:55
Add a comment
1

I fixed it acting in my server.js

the io instance is initialized as follow:

const io = socket.listen(httpServer, { serveClient: true })

Before I had { serveClient: false }, because otherwise, I was getting an error. But actually, if you want that your client takes io from the node instance you have to serve it.

UPDATE: At the end.. you want to simply have const io = socket.listen(httpServer) In this way is going to be true by default.

Share
Edit
Follow
answered Apr 16, 2020 at 14:58
Marco Vanali's user avatar
Marco Vanali
7111 silver badge66 bronze badges
Add a comment
1

My solution was to upgrade node.js to latest (0.12.0 at the time of this post). Originally node.js was installed as a part of a bundle. Once I uninstalled that node.js coming from that bundle (Aptana 3 bundle, node.js was somewhat behind), and installed the latest from node.js's website, things started working finally.

I was experimenting with React.js. I spent several hours debugging the phenomena, I've found build errors in socket.io, specifically about socket.io-client, it tried to invoke Visual Studio MSBuild unsuccesfully. Which is sad, the error occured with node-gyp too. Apparently socket.io-client is not needed to run/serve my examples, and seems like these unfortunate errors (which lured me into an endless forest) can be ignored.

(I noticed also a module while installing webpack-dev-server, which is Darwin only (a.k.a. Mac OS X). That's fortunately an optional dependency. It's frightening though: I know that Apple is very hipster, but the majority of the world is non Mac.)

Share
Edit
Follow
answered Feb 13, 2015 at 20:10
Csaba Toth's user avatar
Csaba Toth
10.6k66 gold badges8383 silver badges137137 bronze badges
Add a comment
Your Answer
Not the answer you're looking for? Browse other questions tagged javascriptnode.jssocket.iohttp-status-code-400 or ask your own question.
The Overflow Blog
How a creator of React is rethinking IDEs
A brief summary of language model finetuning
Featured on Meta
Upcoming initiatives on Stack Overflow and across the Stack Exchange network...
Call for testers for an early access release of a Stack Overflow extension...
Hot Meta Posts
19
Overwhelmed when processing questions in staging ground
82
We've cleared the backlog of "In need of moderator intervention" flags

Report this ad
9 people chatting
JavaScript
yesterday - 1.21 gigawatts
VLAZ: Oct 30 at 22:34
JamesBot: Oct 27 at 22:34
ThiefMaster: Oct 5 at 0:29
Alex: Sep 17 at 21:24
Cerbrus: Aug 30 at 19:20
Ekin: Nov 6 at 15:18
Related
0
No transport available socket.io.js
7
Socket.io error
11
socket.io handshake return error "Transport unknown"
7
socket.io and node.js 400 Bad Request
1
Error 404 when trying to get socket.io
5
Transport error with socket io
1
Socket.io Transport Unknown error. Everywhere
1
Socket Io Error on connection (Error during WebSocket handshake: Unexpected response code: 400)
5
Socket.IO failed: Error during WebSocket handshake: Unexpected response code: 400
0
socket.io: 404 errors in javascript console
Hot Network Questions
Can the dikaryotic mycelium of Agaricus bisporus develop chlamydospores under certain conditions?
Letting Part act on a list while holding the elements inside
Can there exist a definable "ultrafilter" on the ordinals?
Why do best practices recommend against adding your own pepper to passwords before hashing?
Defeating a homeland that can't be invaded
How can a theory of gravitons produce a metric that shortens spatial distances?
A novel about time travel portals, tours to Roman empire and a boy raised by Mongol warriors
What does doubling negative money do?
Monitor network usage during a specific time range within the day and generate report on monthly usage when needed
What is the benefit of transfering oxalic acid to a volumetric flask via a glass funnel?
hfe value of transistor
/ç/ after high vowels in Hexagonal French
Does the Heisenberg uncertainty principle only allow location OR momentum to exist?
Suzuki piano books usage clarification?
Metrics of constant Gauss curvature on 2-cylinder
An Extremely Simple Programming Language
What is the difference between disabling chip with directly disconnect power and with enable pin?
Increased, higher pitch rolling noise after tire change
Large "internal" categories and "finite" products
Can you win this territory game while going second?
What is the command I should use to send a gzipped drive image for extraction to the disk of a remote server?
Do I need to comply with GDPR for a hobby website that displays information of all visitors?
Can we make human skeleton walk?
Can I bring 5 kg rice and 3 kg lentils and other Indian items from Bangalore to Bordeaux?
 Question feed

Stack Overflow
Questions
Help
Chat
Products
Teams
Advertising
Talent
Company
About
Press
Work Here
Legal
Privacy Policy
Terms of Service
Contact Us
Cookie Settings
Cookie Policy
Stack Exchange Network
Technology
Culture & recreation
Life & arts
Science
Professional
Business
API
Data
Blog
Facebook
Twitter
LinkedIn
Instagram
Site design / logo © 2024 Stack Exchange Inc; user contributions licensed under CC BY-SA . rev 2024.11.4.17887