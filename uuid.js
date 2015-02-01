function uuid() {
    return Date.now().toString(36) +
        (Math.random() * Math.random()).toString(36).substring(2, 10);
}

module.exports = uuid;