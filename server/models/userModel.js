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
    firstName: {type: String},
    lastName: {type: String},
    creditBalance: {type: Number, default: 5},
    webhookProcessed: {
        type: Map,
        of: String,
        default: {}
    }
});

const userModel = mongoose.models.user || mongoose.model("user", userSchema);

export default userModel;