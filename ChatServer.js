// Require the packages we will use:
var http = require("http"),
socketio = require("socket.io"),
fs = require("fs");

var users = []; //keys of userSocketIds dict
var userSocketIds = []; //socektId for every loggedin user
var roomsInfo = []; //Room details like name type etc.
var roomNames = []; //keys of roomsInfo dict
var usersInRoom = []; //users in a room and also temp_banned and perm_banned users
var userReportedCount = []; //keeps track of how mane users reported a user in a room

//create a new room and update roomNames, roomsInfo variables
//create an empty lists for users in room - users, tempbanned, and permbanned list
//and push that list to usersInRoom variable
function createNewRoom(name, pwd, cr) {	
	roomNames.push(name);
	var privateRoom = true;
	if(pwd === "nopwd")
		privateRoom = false;
	var room = {roomName:name, isPrivate:privateRoom, password:pwd, creator:cr, timeStamp:Date()};
	roomsInfo[name] = room;
	var messageArray = [];
	messageArray.push(roomsInfo[name]);
	io.sockets.emit("roomnames_to_client",{message:messageArray });
	
	var usersList = {users:[], temp_ban:[],perm_ban:[]};
	usersInRoom[name] = usersList;
}

//Check if user is allowed to enter a room. return message -
//yes is user is allowed, error message otherwise
function isUserAllowed(roomName, userName) {
	
	var usersList = usersInRoom[roomName];
	if(usersList.temp_ban.indexOf(userName) != -1)
		return "User is temporarily banned";
	if(usersList.perm_ban.indexOf(userName) != -1)
		return "User is Permanently banned";
	return "yes";
}

//User is trying to enter a room. If user is allowed, then update
//usersInRoom variable, and send users already present in the room
//list to the user. Otherwise return error message
function enterRoom(roomName, userName) {
	var msg = isUserAllowed(roomName, userName);
	var socketId = userSocketIds[userName];

	if(msg === "yes") {
		usersInRoom[roomName].users.push(userName);
		
		var messageArray = [];
		messageArray.push(roomsInfo[roomName].creator);
		messageArray.push(usersInRoom[roomName].users);
		messageArray.push(usersInRoom[roomName].temp_ban);
		
		
		io.to(socketId).emit("usernames_to_client", {message:messageArray});
		return true;
	} else {
		io.to(socketId).emit("error_Message",{message:msg});
		return false;
	}
}

//check is user provided pwd is same as the room pwd
function isValidRoomPassword(roomName, pwd) {
	return (roomsInfo[roomName].password === pwd);
}

//A new user entered the room, send that info to
//other users in the room
function sendUserJoinedMsg(roomName, userName) {
		var messageArray = [];
		messageArray.push(roomsInfo[roomName].creator);
		var userArray = [];
		userArray.push(userName);
		messageArray.push(userArray);
		messageArray.push([]);
		io.sockets.in(roomName).emit('user_joined_room', {message:messageArray});
}

// Listen for HTTP connections.  This is essentially a miniature static file server that only serves our one file, client.html:
var app = http.createServer(function(req, resp){
	// This callback runs when a new connection is made to our HTTP server.

	fs.readFile("ChatClient.html", function(err, data){
		// This callback runs when the client.html file has been read from the filesystem.

		if(err)
			return resp.writeHead(500);
		resp.writeHead(200);
		resp.end(data);
	});
});
app.listen(3456);

// Do the Socket.IO magic:
var io = socketio.listen(app);
io.sockets.on("connection", function(socket) {
	// This callback runs when a new Socket.IO connection is established.
	socket.on('message_to_server', function(data) {
		io.sockets.in(socket.room).emit('message_to_client', data);
	});

	//Client sent nickaname, if that name is not taken already, display chat app
	// with all rooms to the user and update all users variable and also
	//store socketid for that user in userSocketIds variable
	//otherwise send error message to the user
	socket.on('nickname_to_server', function(data) {
		if(users.indexOf(data.message) !== -1) {
			socket.emit('nickname_already_taken', {nickname:data.message});
			return;
		}
		socket.emit('display_page_with_name', {nickname:data.message});
		users.push(data.message);
		userSocketIds[data.message] = socket.id;
		socket.room = "NoRoom";
		var messageArray = [];
		for(var i = 0; i < roomNames.length; i++) {
			
			messageArray.push(roomsInfo[roomNames[i]]);
		}
		socket.emit("roomnames_to_client", {message:messageArray});
	});

	//Client created a new public room. If room with that name already exists,
	//then send an error message to the user. Otherwise create a new room
	socket.on('new_public_room', function(data) {
		var tokens = data.message.split(",");
		if(roomNames.indexOf(tokens[0]) !== -1) {
			socket.emit('roomname_already_taken', {roomname:tokens[0]});
			return;
		}
		createNewRoom(tokens[0], "nopwd", tokens[1]);
	});

	//Client created a new private room. If room with that name already exists,
	//then send an error message to the user. Otherwise create a new room
	socket.on('new_private_room', function(data) {
		var tokens = data.message.split(",");
		if(roomNames.indexOf(tokens[0]) !== -1) {
			socket.emit('roomname_already_taken', {roomname:tokens[0]});
			return;
		}
		createNewRoom(tokens[0], tokens[1], tokens[2]);
	});
	
	//Client is trying to enter a public room. If user enters it successfully, then
	//check if user was in a room already and leave that if true
	//and send a message to other users about the user leaving the room
	//Then join the new room and update usersInRoom list for the new room.
	//Send a message to the users in room about new user joining in
	socket.on('enter_public_room', function(data) {
		var tokens = data.message.split(",");
		if(enterRoom(tokens[0], tokens[1])) {
			
			if(socket.room != "NoRoom") {
				socket.leave(socket.room);
				room = socket.room;
				socket.room = "";
				var index = usersInRoom[room].users.indexOf(tokens[1]);
				usersInRoom[room].users.splice(index, 1);
				io.sockets.in(room).emit('user_left_room', {name:tokens[1]});
			}
			sendUserJoinedMsg(tokens[0], tokens[1]);
			socket.room = tokens[0];
			socket.join(tokens[0]);
		}
	});
	
	//Client is trying to enter a private room.If pwd is invalid send an error
	//message to the user. If user enters it successfully, then
	//check if user was in a room already and leave that if true
	//and send a message to other users about the user leaving the room
	//Then join the new room and update usersInRoom list for the new room.
	//Send a message to the users in room about new user joining in
	socket.on('enter_private_room', function(data) {
		
		var tokens = data.message.split(",");
		if(isValidRoomPassword(tokens[0], tokens[1])) {
			if(enterRoom(tokens[0], tokens[2])) {
			
				if(socket.room != "NoRoom") {
					
					socket.leave(socket.room);
					room = socket.room;
					socket.room = "";
					var index = usersInRoom[room].users.indexOf(tokens[2]);
					usersInRoom[room].users.splice(index, 1);
					io.sockets.in(room).emit('user_left_room', {name:tokens[2]});
				}
				sendUserJoinedMsg(tokens[0], tokens[2]);
				socket.room = tokens[0];
				socket.join(tokens[0]);
			}
		}
		else {
			var socketId = userSocketIds[tokens[2]];
			io.to(socketId).emit("error_Message",{message:"Invalid Password"});
		}
	});
	
	//A user is permanently banned from the room. remove user from usersInRoom list for
	//that room and update temp_ban list, send a message to the user about being banned and evict the user from the room.
	//Send a message to remaining users in the room about user leaving the room
	socket.on('perm_ban_user', function(data) {
		var tokens = data.message.split(",");
		var roomName = tokens[0];
		var userToBan = tokens[1];
		var index = usersInRoom[roomName].users.indexOf(userToBan);
		usersInRoom[roomName].users.splice(index, 1);
		usersInRoom[roomName].perm_ban.push(userToBan);
		var socketId = userSocketIds[userToBan];
		io.sockets.connected[socketId].leave(socket.room);
		io.sockets.connected[socketId].room = "NoRoom";
		
		io.to(socketId).emit("user_perm_banned_from_room",{message:"You are permanently banned from " + roomName});
		io.sockets.in(roomName).emit('user_left_room', {name:tokens[1]});
	});

	//A user is temporarily banned from the room. remove user from usersInRoom list and update
	//temp_ban list for that room send a message to the user about being banned and evict the user from the room.
	//Send a message to remaining users in the room about user being banned from the room
	socket.on('temp_ban_user', function(data) {
		var tokens = data.message.split(",");
		var roomName = tokens[0];
		var userToBan = tokens[1];
		var index = usersInRoom[roomName].users.indexOf(userToBan);
		usersInRoom[roomName].users.splice(index, 1);
		usersInRoom[roomName].temp_ban.push(userToBan);
		
		var socketId = userSocketIds[userToBan];
		io.sockets.connected[socketId].leave(socket.room);
		io.sockets.connected[socketId].room = "NoRoom";
		
		io.to(socketId).emit("user_temp_banned_from_room", {room:roomName});
		io.sockets.in(roomName).emit('temp_ban_user', {name:tokens[1]});
	});
	
	//A temporarily banned user is unbanned by the creator. remove user from temp_ban list for that room
	//send a message to the user about being unbanned and send a message to the creator about successfully
	//unbanning the user
	socket.on('unban_temp_user', function(data) {
		
		var userToUnban = data.userName;
		var room = data.roomName;
		var socketId = userSocketIds[userToUnban];
		io.to(socketId).emit("can_enter_room_now", {roomName:room});
		
		var index = usersInRoom[room].temp_ban.indexOf(userToUnban);
		usersInRoom[room].temp_ban.splice(index, 1);
		
		socket.emit('unban_a_user', {name:userToUnban});
	});
	
	//A user is being reported by another user.
	socket.on('report_user', function(data) {
		//This user is reported in this room for the first time.
		//create a new element for this user and room and push that element to
		//userReportedCount variable
		if(!userReportedCount[data.user + data.room]) {
			userReportedCount[data.user + data.room] = [];
			userReportedCount[data.user + data.room].push(data.reportedBy);
		} else {
			
			//If user is not reported by reportedBy in that room before, add reportedBy to array
			//If reportedBy already reported in that room, do nothing
			if(userReportedCount[data.user + data.room].indexOf(data.reportedBy) == -1) {
				userReportedCount[data.user + data.room].push(data.reportedBy);
				//If 3 unique users reported someone in a room, permanently ban the user
				if(userReportedCount[data.user + data.room].length === 3) {
					//permanently ban the user
					var index = usersInRoom[data.room].users.indexOf(data.user);
					usersInRoom[data.room].users.splice(index, 1);
					usersInRoom[data.room].perm_ban.push(data.user);
					var socketId = userSocketIds[data.user];
					io.sockets.connected[socketId].leave(data.room);
					io.sockets.connected[socketId].room = "NoRoom";
		
					//Send a message to the user about being reported by 3 users, and that they are banned permanently
					io.to(socketId).emit("user_perm_banned_from_room",{message:"3 users reported you in " + data.room +
											". You are permanently banned from the room"});
					
					//Send user left message to remaining users in the room
					io.sockets.in(data.room).emit('user_left_room', {name:data.user});
				}
			}
		}
	});
	
	//sending a private message, send message to both receiver and sender
	socket.on('send_private_msg', function(data) {
		var tokens = data.message.split(",");
		var sender = tokens[0];
		var receiver = tokens[1];
		var msg = tokens[2];
		
		var senderSocketId = userSocketIds[sender];
		var receiverSocketId = userSocketIds[receiver];
		//message to receiver
		io.to(receiverSocketId).emit("msg_to_receiver", { message: msg,
									 sentBy : sender});
		//message to sender
		io.to(senderSocketId).emit("msg_to_sender", {message: msg, sentTo: receiver, sentBy : sender});
		
	});
});