import { Webhook } from "svix"
import userModel from "../models/userModel.js"
import razorpay from 'razorpay'
import transactionModel from "../models/transactionModel.js"

const clerkWebhooks = async (req, res) => {
    try {
        const requiredHeaders = ['svix-id', 'svix-signature', 'svix-timestamp']
        for (const header of requiredHeaders) {
            if (!req.headers[header]) {
                return res.status(400).json({ error: `Missing required header: ${header}` })
            }
        }

        const whook = new Webhook(process.env.CLERK_WEBHOOK_SECRET)
        await whook.verify(JSON.stringify(req.body), {
            "svix-id": req.headers["svix-id"],
            "svix-signature": req.headers["svix-signature"],
            "svix-timestamp": req.headers["svix-timestamp"]
        })

        const { data, type } = req.body
        const primaryEmail = data.email_addresses.find(email => email.id === data.primary_email_address_id)
        const email = primaryEmail ? primaryEmail.email_address : data.email_addresses[0]?.email_address

        switch (type) {
            case "user.created": {
                const userData = {
                    clerkId: data.id,
                    email: email,
                    photo: data.image_url,
                    firstName: data.first_name,
                    lastName: data.last_name
                }

                await userModel.create(userData)
                res.status(200).json({ success: true })
                break;
            }
            case "user.updated": {
                const userData = {
                    email: email,
                    photo: data.image_url,
                    firstName: data.first_name,
                    lastName: data.last_name
                }

                await userModel.findOneAndUpdate(
                    { clerkId: data.id },
                    userData,
                    { new: true }
                )
                res.status(200).json({ success: true })
                break;
            }
            case "user.deleted": {
                await userModel.findOneAndDelete({ clerkId: data.id })
                res.status(200).json({ success: true })
                break;
            }
            default:
                res.status(200).json({ success: true, message: 'Event type not handled' })
                break;
        }
    } catch (error) {
        console.error('Webhook error:', error.message);

        if (error.message.includes('Webhook verification failed')) {
            return res.status(401).json({ success: false, message: 'Unauthorized' })
        }

        res.status(500).json({ success: false, message: 'Internal server error' })
    }
}

const userCredits = async (req, res) => {
    try {
        const { clerkId } = req.user
        const userData = await userModel.findOne({ clerkId })

        if (!userData) {
            return res.json({ success: false, message: 'User not found' });
        }

        res.json({ success: true, credits: userData.creditBalance })
    } catch (error) {
        console.log(error.message);
        res.json({ success: false, message: error.message });
    }
}

const razorpayInstance = new razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
})

const paymentRazorpay = async (req, res) => {
    try {
        const { clerkId } = req.user
        const { planId } = req.body

        const userData = await userModel.findOne({ clerkId })

        if (!userData || !planId) {
            res.json({ success: false, message: 'Invalid credentials' });
        }

        let credits, plan, amount, date

        switch (planId) {
            case 'Basic':
                plan = 'Basic'
                credits = 100
                amount = 10
                break;
            case 'Advanced':
                plan = 'Advanced'
                credits = 500
                amount = 50
                break;
            case 'Business':
                plan = 'Business'
                credits = 5000
                amount = 250
                break;
            default:
                break;
        }

        date = Date.now()

        const transactionData = {
            clerkId,
            plan,
            amount,
            credits,
            date
        }

        const newTransaction = await transactionModel.create(transactionData)
        const options = {
            amount: amount * 100,
            currency: process.env.CURRENCY,
            receipt: newTransaction._id
        }

        await razorpayInstance.orders.create(options, (error, order) => {
            if (error) {
                return res.json({ success: false, message: error })
            }
            res.json({ success: true, order })
        })
    } catch (error) {
        console.log(error.message);
        res.json({ success: false, message: error.message });
    }
}

const verifyRazorpay = async (req, res) => {
    try {
        const { razorpay_order_id } = req.body
        const orderinfo = await razorpayInstance.orders.fetch(razorpay_order_id)

        if (orderinfo.status === 'paid') {
            const transactionData = await transactionModel.findById(orderinfo.receipt)
            if (transactionData.payment) {
                return res.json({ success: false, message: 'Payment Failed' })
            }

            const userData = await userModel.findOne({ clerkId: transactionData.clerkId })
            const creditBalance = userData.creditBalance + transactionData.credits
            await userModel.findByIdAndUpdate(userData._id, { creditBalance })

            await transactionModel.findByIdAndUpdate(transactionData._id, { payment: true })
            res.json({ success: true, message: 'Credits Added' })
        }
    } catch (error) {
        console.log(error.message);
        res.json({ success: false, message: error.message });
    }
}

export { clerkWebhooks, userCredits, paymentRazorpay, verifyRazorpay }