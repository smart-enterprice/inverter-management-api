export const buildResponse = ({
    res,
    status = 200,
    message,
    data,
    extra = {}
}) => {
    return res.status(status).json({
        success: true,
        status,
        message,
        data,
        ...extra,
        timestamp: new Date().toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata"
        })
    });
};