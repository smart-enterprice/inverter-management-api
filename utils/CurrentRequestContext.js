import { AsyncLocalStorage } from 'async_hooks';

const asyncLocalStorage = new AsyncLocalStorage();

const CurrentRequestContext = {
setContext(context) {
    asyncLocalStorage.enterWith(context);
},

getContext() {
    return asyncLocalStorage.getStore() || {};
},

getCurrentTenant() {
    return this.getContext().tenant;
},

setCurrentTenant(tenant) {
    const context = this.getContext();
    context.tenant = tenant;
},

getRole() {
    return this.getContext().role;
},

setRole(role) {
    const context = this.getContext();
    context.role = role;
},

getCurrentIdentifier() {
    return this.getContext().identifier;
},

setCurrentIdentifier(identifier) {
    const context = this.getContext();
    context.identifier = identifier;
},

getCurrentToken() {
    return this.getContext().token;
},

setCurrentToken(token) {
    const context = this.getContext();
    context.token = token;
},

getEmployeeId() {
    return this.getContext().employeeId;
},

setEmployeeId(id) {
    const context = this.getContext();
    context.employeeId = id;
},

clearContext() {
    asyncLocalStorage.enterWith({});
}
};

export { CurrentRequestContext, asyncLocalStorage };
