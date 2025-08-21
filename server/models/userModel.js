import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    clerkId: {
        type: String, 
        required: true, 
        unique: true,
        index: true 
    },
    email: {
        type: String, 
        required: true, 
        unique: true,
        index: true
    },
    photo: {
        type: String, 
        required: false, 
        default: null
    },
    firstName: {
        type: String,
        default: null
    },
    lastName: {
        type: String,
        default: null
    },
    creditBalance: {
        type: Number, 
        default: 5,
        min: 0
    }
}, {
    timestamps: true, 
    versionKey: '__v'
});

userSchema.index({ clerkId: 1, email: 1 });

userSchema.methods.addCredits = function(amount) {
    this.creditBalance = Math.max(0, this.creditBalance + amount);
    return this.save();
};

userSchema.methods.deductCredits = function(amount) {
    if (this.creditBalance >= amount) {
        this.creditBalance -= amount;
        return this.save();
    } else {
        throw new Error('Insufficient credits');
    }
};

userSchema.post('save', function(error, doc, next) {
    if (error.name === 'MongoError' && error.code === 11000) {
        console.log('Duplicate key error caught:', error.message);
        next(new Error('User already exists'));
    } else {
        next(error);
    }
});

const userModel = mongoose.models.user || mongoose.model("user", userSchema);

export default userModel;