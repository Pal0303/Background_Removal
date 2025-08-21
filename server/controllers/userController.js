import { Webhook } from "svix"
import userModel from "../models/userModel.js"
import razorpay from 'razorpay'
import transactionModel from "../models/transactionModel.js"

const clerkWebhooks = async (req, res) => {
    const startTime = Date.now()
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Webhook timeout after 25 seconds')), 25000)
    })

    try {
        console.log('Webhook received:', {
            type: req.body?.type,
            headers: Object.keys(req.headers),
            timestamp: new Date().toISOString()
        })
        await Promise.race([
            processWebhook(req, res, startTime),
            timeoutPromise
        ])
        
    } catch (error) {
        const duration = Date.now() - startTime
        console.error('Webhook error:', {
            message: error.message,
            stack: error.stack,
            duration: `${duration}ms`,
            timestamp: new Date().toISOString()
        })

        if (error.message.includes('timeout')) {
            return res.status(408).json({ 
                success: false, 
                message: 'Request timeout' 
            })
        }

        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        })
    }
}

const processWebhook = async (req, res, startTime) => {
    try {

        if (!process.env.CLERK_WEBHOOK_SECRET) {
            console.error('CLERK_WEBHOOK_SECRET is not configured')
            return res.status(500).json({ error: 'Webhook secret not configured' })
        }

        const { data, type } = req.body
        if (!data || !type) {
            console.error('Missing data or type in request body')
            return res.status(400).json({ error: 'Missing data or type in request body' })
        }

        const requiredHeaders = ['svix-id', 'svix-signature', 'svix-timestamp']
        const missingHeaders = requiredHeaders.filter(header => !req.headers[header])
        
        if (missingHeaders.length > 0) {
            console.error('Missing headers:', missingHeaders)
            return res.status(400).json({ 
                error: `Missing required headers: ${missingHeaders.join(', ')}` 
            })
        }

        if (!req.body || typeof req.body !== 'object') {
            console.error('Invalid request body:', req.body)
            return res.status(400).json({ error: 'Invalid request body' })
        }

        const whook = new Webhook(process.env.CLERK_WEBHOOK_SECRET)
        let payload
        
        try {
            const verificationStart = Date.now()
            payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
            const verifyPromise = whook.verify(payload, {
                "svix-id": req.headers["svix-id"],
                "svix-signature": req.headers["svix-signature"],
                "svix-timestamp": req.headers["svix-timestamp"]
            })
            
            const verifyTimeout = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Verification timeout')), 5000)
            })
            
            await Promise.race([verifyPromise, verifyTimeout])
            
            console.log(`Verification took: ${Date.now() - verificationStart}ms`)
            
        } catch (verificationError) {
            console.error('Webhook verification failed:', verificationError.message)
            return res.status(401).json({ 
                success: false, 
                message: 'Webhook verification failed' 
            })
        }

        let email = null
        if (data.email_addresses && Array.isArray(data.email_addresses)) {
            if (data.primary_email_address_id) {
                const primaryEmail = data.email_addresses.find(
                    email => email.id === data.primary_email_address_id
                )
                email = primaryEmail?.email_address
            }
            
            if (!email && data.email_addresses.length > 0) {
                email = data.email_addresses[0]?.email_address
            }
        }

        console.log('Processing webhook:', { type, clerkId: data.id, email })

        switch (type) {
            case "user.created": {
                try {
                    const dbStart = Date.now()
                    const existingUser = await userModel.findOne({ clerkId: data.id })
                        .lean()
                        .maxTimeMS(3000)
                        
                    console.log(`DB lookup took: ${Date.now() - dbStart}ms`)
                    
                    if (existingUser) {
                        console.log('User already exists:', data.id)
                        return res.status(200).json({ 
                            success: true, 
                            message: 'User already exists' 
                        })
                    }

                    const userData = {
                        clerkId: data.id,
                        email: email,
                        photo: data.image_url || null,
                        firstName: data.first_name || null,
                        lastName: data.last_name || null,
                        creditBalance: 2 
                    }

                    console.log('Creating user:', userData)
                    
                    const createStart = Date.now()
                    
                    const createPromise = userModel.create(userData)
                    const createTimeout = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('User creation timeout')), 5000)
                    })
                    
                    const newUser = await Promise.race([createPromise, createTimeout])
                    
                    console.log(`User creation took: ${Date.now() - createStart}ms`)
                    console.log('User created successfully:', newUser._id)
                    
                    const totalDuration = Date.now() - startTime
                    console.log(`Total webhook processing time: ${totalDuration}ms`)
                    
                    res.status(200).json({ success: true, userId: newUser._id })
                } catch (createError) {
                    console.error('Error creating user:', createError)
                    if (createError.code === 11000) {
                        return res.status(200).json({ 
                            success: true, 
                            message: 'User already exists' 
                        })
                    }
                    throw createError
                }
                break;
            }

            case "user.updated": {
                try {
                    const dbStart = Date.now()
                    
                    const userData = {
                        email: email,
                        photo: data.image_url || null,
                        firstName: data.first_name || null,
                        lastName: data.last_name || null
                    }

                    Object.keys(userData).forEach(key => {
                        if (userData[key] === null || userData[key] === undefined) {
                            delete userData[key]
                        }
                    })

                    console.log('Updating user:', { clerkId: data.id, userData })
                    const updatePromise = userModel.findOneAndUpdate(
                        { clerkId: data.id },
                        { $set: userData },
                        { new: true, runValidators: true, maxTimeMS: 3000 }
                    )
                    
                    const updateTimeout = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('User update timeout')), 5000)
                    })
                    
                    const updatedUser = await Promise.race([updatePromise, updateTimeout])
                    
                    console.log(`User update took: ${Date.now() - dbStart}ms`)

                    if (!updatedUser) {
                        console.warn('User not found for update:', data.id)
                        return res.status(404).json({ 
                            success: false, 
                            message: 'User not found' 
                        })
                    }

                    console.log('User updated successfully:', updatedUser._id)
                    res.status(200).json({ success: true, userId: updatedUser._id })
                } catch (updateError) {
                    console.error('Error updating user:', updateError)
                    throw updateError
                }
                break;
            }

            case "user.deleted": {
                try {
                    const dbStart = Date.now()
                    console.log('Deleting user:', data.id)
                    
                    const deletePromise = userModel.findOneAndDelete({ clerkId: data.id })
                        .maxTimeMS(3000)
                    
                    const deleteTimeout = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('User deletion timeout')), 5000)
                    })
                    
                    const deletedUser = await Promise.race([deletePromise, deleteTimeout])
                    
                    console.log(`User deletion took: ${Date.now() - dbStart}ms`)
                    
                    if (!deletedUser) {
                        console.warn('User not found for deletion:', data.id)
                        return res.status(404).json({ 
                            success: false, 
                            message: 'User not found' 
                        })
                    }

                    console.log('User deleted successfully:', deletedUser._id)
                    res.status(200).json({ success: true, userId: deletedUser._id })
                } catch (deleteError) {
                    console.error('Error deleting user:', deleteError)
                    throw deleteError
                }
                break;
            }

            default:
                console.log('Unhandled event type:', type)
                res.status(200).json({ 
                    success: true, 
                    message: `Event type '${type}' not handled` 
                })
                break;
        }
    } catch (error) {
        console.error('Webhook error:', {
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        })

        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        })
    }
}

const userCredits = async (req, res) => {
    try {
        const { clerkId } = req.user
        
        if (!clerkId) {
            return res.status(400).json({ 
                success: false, 
                message: 'ClerkId is required' 
            })
        }

        const userData = await userModel.findOne({ clerkId })

        if (!userData) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            })
        }

        res.json({ 
            success: true, 
            credits: userData.creditBalance || 0 
        })
    } catch (error) {
        console.error('Error fetching user credits:', error)
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        })
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

        if (!clerkId || !planId) {
            return res.status(400).json({ 
                success: false, 
                message: 'ClerkId and planId are required' 
            })
        }

        const userData = await userModel.findOne({ clerkId })

        if (!userData) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            })
        }

        let credits, plan, amount

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
                return res.status(400).json({ 
                    success: false, 
                    message: 'Invalid plan selected' 
                })
        }

        const transactionData = {
            clerkId,
            plan,
            amount,
            credits,
            date: new Date(),
            payment: false
        }

        const newTransaction = await transactionModel.create(transactionData)
        
        const options = {
            amount: amount * 100, // Convert to paisa
            currency: process.env.CURRENCY || 'INR',
            receipt: newTransaction._id.toString()
        }

        const order = await razorpayInstance.orders.create(options)
        
        res.json({ 
            success: true, 
            order,
            transactionId: newTransaction._id 
        })
        
    } catch (error) {
        console.error('Payment creation error:', error)
        res.status(500).json({ 
            success: false, 
            message: 'Payment creation failed' 
        })
    }
}

const verifyRazorpay = async (req, res) => {
    try {
        const { razorpay_order_id } = req.body

        if (!razorpay_order_id) {
            return res.status(400).json({ 
                success: false, 
                message: 'Order ID is required' 
            })
        }

        const orderInfo = await razorpayInstance.orders.fetch(razorpay_order_id)

        if (orderInfo.status === 'paid') {
            const transactionData = await transactionModel.findById(orderInfo.receipt)
            
            if (!transactionData) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'Transaction not found' 
                })
            }

            if (transactionData.payment) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Payment already processed' 
                })
            }

            const userData = await userModel.findOne({ clerkId: transactionData.clerkId })
            
            if (!userData) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'User not found' 
                })
            }

            const newCreditBalance = (userData.creditBalance || 0) + transactionData.credits
            
            await userModel.findByIdAndUpdate(userData._id, { 
                creditBalance: newCreditBalance 
            })

            await transactionModel.findByIdAndUpdate(transactionData._id, { 
                payment: true 
            })

            res.json({ 
                success: true, 
                message: 'Credits added successfully',
                newBalance: newCreditBalance
            })
        } else {
            res.status(400).json({ 
                success: false, 
                message: 'Payment not completed' 
            })
        }
    } catch (error) {
        console.error('Payment verification error:', error)
        res.status(500).json({ 
            success: false, 
            message: 'Payment verification failed' 
        })
    }
}

export { clerkWebhooks, userCredits, paymentRazorpay, verifyRazorpay }