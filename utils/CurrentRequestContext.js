import { AsyncLocalStorage } from 'async_hooks';

const asyncLocalStorage = new AsyncLocalStorage();

const CurrentRequestContext = {

    run(context, callback) {
        return asyncLocalStorage.run(context, callback);
    },

    getContext() {
        return asyncLocalStorage.getStore() || {};
    },

    clearContext() {
        asyncLocalStorage.enterWith({});
    },

    getEmployeeId() {
        return this.getContext().employeeId;
    },

    getRole() {
        return this.getContext().role;
    },

    getCurrentTenant() {
        return this.getContext().tenant;
    },

    getCurrentIdentifier() {
        return this.getContext().identifier;
    },

    getCurrentToken() {
        return this.getContext().token;
    },

    setEmployeeId(id) {
        const context = this.getContext();
        context.employeeId = id;
    },

    setRole(role) {
        const context = this.getContext();
        context.role = role;
    },

    setCurrentTenant(tenant) {
        const context = this.getContext();
        context.tenant = tenant;
    },

    setCurrentIdentifier(identifier) {
        const context = this.getContext();
        context.identifier = identifier;
    },

    setCurrentToken(token) {
        const context = this.getContext();
        context.token = token;
    }
};

export { CurrentRequestContext };