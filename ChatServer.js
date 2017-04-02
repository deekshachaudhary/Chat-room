// Require the packages we will use:
var http = require("http"),
socketio = require("socket.io"),
fs = require("fs");

var users = []; //keys of userSocketIds dict
var userSocketIds = []; //socektId for every loggedin user
var roomsInfo = []; //Room details like name type etc.
var roomNames = []; //keys of roomsInfo dict
var usersInRoom = []; //users in a room and also temp_banned and perm_banned users

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

function isUserAllowed(roomName, userName) {
	
	var usersList = usersInRoom[roomName];
	if(usersList.temp_ban.indexOf(userName) != -1)
		return "User is temporarily banned";
	if(usersList.perm_ban.indexOf(userName) != -1)
		return "User is Permanently banned";
	return "yes";
}

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

function isValidRoomPassword(roomName, pwd) {
	return (roomsInfo[roomName].password === pwd);
}

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
		//console.log(data);
		// This callback runs when the server receives a new message from the client.
		//console.log("message: " + data.message); // log it to the Node.JS output
		//var input = data.message + "," + data.name;
		io.sockets.in(socket.room).emit('message_to_client', data);
	});

	socket.on('nickname_to_server', function(data) {
		//console.log("nickname - " + data.message); // log it to the Node.JS output
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
		//console.log("display all room names - " + messageArray);
		socket.emit("roomnames_to_client", {message:messageArray});
	});

	socket.on('new_public_room', function(data) {
		var tokens = data.message.split(",");
		if(roomNames.indexOf(tokens[0]) !== -1) {
			socket.emit('roomname_already_taken', {roomname:tokens[0]});
			return;
		}
		createNewRoom(tokens[0], "nopwd", tokens[1]);
		//console.log("New Public room created with name " + tokens[0] + " by " + tokens[1]);
	});

	socket.on('new_private_room', function(data) {
		var tokens = data.message.split(",");
		if(roomNames.indexOf(tokens[0]) !== -1) {
			socket.emit('roomname_already_taken', {roomname:tokens[0]});
			return;
		}
		createNewRoom(tokens[0], tokens[1], tokens[2]);
		//console.log("New Private room created with name " + tokens[0] + " by " + tokens[2]);
	});
	
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
	
	socket.on('enter_private_room', function(data) {
		
		var tokens = data.message.split(",");
		if(isValidRoomPassword(tokens[0], tokens[1])) {
			if(enterRoom(tokens[0], tokens[2])) {
			
				if(socket.room != "NoRoom") {
					io.sockets.in(socket.room).emit('user_left_room', {name:tokens[2]});
					socket.leave(socket.room);
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
	
	socket.on('perm_ban_user', function(data) {
		var tokens = data.message.split(",");
		var roomName = tokens[0];
		var userToBan = tokens[1];
		var index = usersInRoom[roomName].users.indexOf(userToBan);
		usersInRoom[roomName].users.splice(index, 1);
		usersInRoom[roomName].perm_ban.push(userToBan);
		var socketId = userSocketIds[userToBan];
		io.sockets.connected[socketId].leave(socket.roomName);
		io.sockets.connected[socketId].roomName = "NoRoom";
		
		io.to(socketId).emit("user_perm_banned_from_room",{message:"Banned"});

		io.sockets.in(roomName).emit('user_left_room', {name:tokens[1]});
	});

	socket.on('temp_ban_user', function(data) {
		var tokens = data.message.split(",");
		var roomName = tokens[0];
		var userToBan = tokens[1];
		var index = usersInRoom[roomName].users.indexOf(userToBan);
		usersInRoom[roomName].users.splice(index, 1);
		usersInRoom[roomName].temp_ban.push(userToBan);
		
		var socketId = userSocketIds[userToBan];
		io.sockets.connected[socketId].leave(socket.roomName);
		io.sockets.connected[socketId].roomName = "NoRoom";
		
		io.to(socketId).emit("user_temp_banned_from_room", {message:"Banned"});

		io.sockets.in(roomName).emit('temp_ban_user', {name:tokens[1]});
	});
	
	socket.on('send_private_msg', function(data) {
		var tokens = data.message.split(",");
		var sender = tokens[0];
		var receiver = tokens[1];
		var msg = tokens[2];
		
		var senderSocketId = userSocketIds[sender];
		var receiverSocketId = userSocketIds[receiver];
		io.to(receiverSocketId).emit("msg_to_receiver", { message:
									 "Private message received from " +sender,
									 username: sender, name: msg});
		io.to(senderSocketId).emit("msg_to_sender", {message:
								   "Private message sent to " +receiver,
								   username: sender, name: msg});
		
	});
});