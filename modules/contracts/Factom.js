var private = {}, self = null,
	library = null, modules = null;

function Factom(cb, _library) {
	self = this;
	self.type = 6
	library = _library;
	cb(null, self);
}

Factom.prototype.create = function (data, trs) {
	trs.recipientId = data.recipientId;
	trs.asset = {
		prevHash: new Buffer(data.prevHash, 'utf8').toString('hex'), // Save previous hash as hex string
		currHash: new Buffer(data.currHash, 'utf8').toString('hex') // Save hash as hex string
	};

	return trs;
}

Factom.prototype.calculateFee = function (trs) {
	return 0;
}

Factom.prototype.verify = function (trs, sender, cb, scope) {
	if (trs.asset.currHash.length > 64) {
		return setImmediate(cb, "Max length of SHA256 in HEX is 64 bytes, something went wrong!");
	}

	setImmediate(cb, null, trs);
}

Factom.prototype.getBytes = function (trs) {
	return new Buffer(trs.asset.currHash, 'hex');
}

Factom.prototype.apply = function (trs, sender, cb, scope) {
	modules.blockchain.accounts.mergeAccountAndGet({
		address: sender.address,
		balance: -trs.fee
	}, cb);
}

Factom.prototype.undo = function (trs, sender, cb, scope) {
	modules.blockchain.accounts.undoMerging({
		address: sender.address,
		balance: -trs.fee
	}, cb);
}

Factom.prototype.applyUnconfirmed = function (trs, sender, cb, scope) {
	if (sender.u_balance < trs.fee) {
		return setImmediate(cb, "Sender doesn't have enough XCR!");
	}

	modules.blockchain.accounts.mergeAccountAndGet({
		address: sender.address,
		u_balance: -trs.fee
	}, cb);
}

Factom.prototype.undoUnconfirmed = function (trs, sender, cb, scope) {
	modules.blockchain.accounts.undoMerging({
		address: sender.address,
		u_balance: -trs.fee
	}, cb);
}

Factom.prototype.ready = function (trs, sender, cb, scope) {
	setImmediate(cb);
}

Factom.prototype.save = function (trs, cb) {
	modules.api.sql.insert({
		table: "asset_hashes",
		values: {
			transactionId: trs.id,
			prevHash: trs.asset.prevHash,
			currHash: trs.asset.currHash
		}
	}, cb);}

Factom.prototype.dbRead = function (row) {
	if (!row.ha_transactionId) {
		return null;
	} else {
		return {
			prevHash: row.ha_prevHash,
			currHash: row.ha_currHash
		};
	}
}

Factom.prototype.normalize = function (asset, cb) {
	library.validator.validate(asset, {
		type: "object", // It is an object
		properties: {
			prevHash: { // It contains a prevHh property
				type: "string", // It is a string
				format: "hex", // It is in a hexadecimal format
				minLength: 64, // Minimum length of string are 32 character
				maxLength: 64 // Minimum length of string are 32 character
			},
			currHash: { // It contains a currHash property
				type: "string", // It is a string
				format: "hex", // It is in a hexadecimal format
				minLength: 64, // Minimum length of string are 32 character
				maxLength: 64 // Minimum length of string are 32 character
			}
		},
		required: ["currHash"] // currHash property is required and must be defined
	}, cb);
}

Factom.prototype.onBind = function (_modules) {
	modules = _modules;
	modules.logic.transaction.attachAssetType(self.type, self);
}

Factom.prototype.add = function (cb, query) {
	library.validator.validate(query, {
		type: "object",
		properties: {
			recipientId: {
				type: "string",
				minLength: 1,
				maxLength: 21
			},
			secret: {
				type: "string",
				minLength: 1,
				maxLength: 100
			},
			prevHash: {
				type: "string",
				minLength: 64
			},
			currHash: {
				type: "string",
				minLength: 64
			}
		}
	}, function (err) {
		// If error exists, execute callback with error as first argument
		if (err) {
			return cb(err[0].message);
		}

		var keypair = modules.api.crypto.keypair(query.secret);
		modules.blockchain.accounts.getAccount({
			publicKey: keypair.publicKey.toString('hex')
		}, function (err, account) {
			// If error occurs, call cb with error argument
			if (err) {
				return cb(err);
			}

			try {
				var transaction = library.modules.logic.transaction.create({
					type: self.type,
					prevHash: query.prevHash,
					currHash: query.currHash,
					recipientId: query.recipientId,
					sender: account,
					keypair: keypair
				});
			} catch (e) {
				// Catch error if something goes wrong
				return setImmediate(cb, e.toString());
			}

			// Send transaction for processing
			modules.blockchain.transactions.processUnconfirmedTransaction(transaction, cb);
		});
	});
}

Factom.prototype.list = function (cb, query) {
	// Verify query parameters
	library.validator.validate(query, {
		type: "object",
		properties: {
			recipientId: {
				type: "string",
				minLength: 2,
				maxLength: 21
			}
		},
		required: ["recipientId"]
	}, function (err) {
		if (err) {
			return cb(err[0].currHash);
		}

		// Select from transactions table and join hashes from the asset_hashes table
		modules.api.sql.select({
			table: "transactions",
			alias: "t",
			condition: {
				recipientId: query.recipientId,
				type: self.type
			},
			join: [{
				type: 'left outer',
				table: 'asset_hashes',
				alias: "ha",
				on: {"t.id": "ha.transactionId"}
			}]
		}, ['id', 'type', 'senderId', 'senderPublicKey', 'recipientId', 'amount', 'fee', 'signature', 'blockId', 'transactionId', 'prevHash', 'currHash'], function (err, transactions) {
			if (err) {
				return cb(err.toString());
			}

			// Map results to asset object
			var hashes = transactions.map(function (tx) {
				tx.asset = {
					prevHash: new Buffer(tx.prevHash, 'hex').toString('utf8'),
					currHash: new Buffer(tx.currHash, 'hex').toString('utf8')
				};

				delete tx.prevHash;
				delete tx.currHash;
				return tx;
			});

			return cb(null, {
				hashes: hashes
			})
		});
	});
}

module.exports = Factom;
