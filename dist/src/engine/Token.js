"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Token = void 0;
const fs = require('fs');
const __1 = require("../../");
const Loop_1 = require("./Loop");
const Item_1 = require("./Item");
/*
 *  Tokens:
 *          Start                       End                     data
 *
 *      1 start of execution              end of execution          execution
 *      2 start of sbuexecution           end of subexecution       own (new object)
 *      3 start of multi-instances      end of instance         own (new object)
 *      4 diverging                     at converge             parent
 *
 *  Rules:
 *      Node acts synchronisly
 *
 *      parent token go on 'HOLD' waiting for children to finish
 *
 *      token;  parent
 *              holdingForCount   when 0 it proceeds to next node
 *
 *   scenario 1:
 *      Event1 -> Task1->GW1 ->     task1      ->gw2            task 3
 *                                  task2      ->gw2
 *       t1         t1    t1(wait)
 *                                  t2          t2 end -t1 wait
 *                                  t3          t3 end -t1 go
 *
 *          when t2 arrives at gw2 - it ends and t1 count--
 *          when t3 arrives at gw2 - it ends and t1 count--
 *              since count==0 t1 will proceed
 *       gw2 logic t2 is from t1- waits for t1 counter to be
 *
 *
 *       ------- Data ----
 *
 *  execution Data execution.data
 *  nodeData
 *
 *
 */
// ---------------------------------------------
// ---------------------------------------------
class Token {
    constructor(execution, startNode, dataPath, parentToken, branchNode) {
        this.execution = execution;
        if (dataPath)
            this.dataPath = dataPath;
        else
            this.dataPath = '';
        this.startNodeId = startNode.id;
        this.currentNode = startNode;
        this.parentToken = parentToken;
        this.branchNode = branchNode;
        this.id = execution.getNewId('token');
        this.processId = startNode.processId;
        this.path = [];
    } /*
    static newToken(execution:Execution, startNode, dataPath, parentToken: Token, branchNode: Node, loop: Loop, data = null) {
        const token = new Token(execution, startNode, dataPath, parentToken, branchNode);
        token.loop = loop;
        execution.tokens.set(token.id, token);
        token.applyInput(data);
        execution.addToQueue(token);
        return token;
    }*/
    get data() {
        return this.execution.getData(this.dataPath);
    }
    get currentItem() {
        return this.path[this.path.length - 1];
    }
    get lastItem() {
        let nodes = this.path.filter(function (value) {
            return (value.element.type == 'bpmn:SequenceFlow') ? false : true;
        });
        if (nodes.length > 1)
            return nodes[nodes.length - 2];
        else
            return null;
    }
    static startNewToken(execution, startNode, dataPath, parentToken, branchNode, loop, data = null) {
        return __awaiter(this, void 0, void 0, function* () {
            const token = new Token(execution, startNode, dataPath, parentToken, branchNode);
            token.loop = loop;
            execution.tokens.set(token.id, token);
            token.applyInput(data);
            const result = yield token.execute(data);
            return token;
        });
    }
    save() {
        let parentToken, branchNode, loopId;
        if (this.parentToken)
            parentToken = this.parentToken.id;
        if (this.branchNode)
            branchNode = this.branchNode.id;
        if (this.loop)
            loopId = this.loop.id;
        const items = [];
        this.path.forEach(i => {
            items.push(i.save());
        });
        return {
            id: this.id, status: this.status, dataPath: this.dataPath, loopId,
            parentToken, branchNode, startNodeId: this.startNodeId,
            currentNode: this.currentNode.id
        };
    }
    static load(execution, da) {
        const startNode = execution.getNodeById(da.startNodeId);
        const parentToken = execution.getToken(da.parentToken);
        const branchNode = execution.getNodeById(da.branchNode);
        const currentNode = execution.getNodeById(da.currentNode);
        const token = new Token(execution, startNode, da.dataPath, parentToken, branchNode);
        token.id = da.id;
        token.startNodeId = da.startNodeId;
        token.currentNode = currentNode;
        token.status = da.status;
        token.path = [];
        return token;
    }
    /*
     * is fired once after the execution is resumed from restrt
     *
     *  fire resume for all existing items to wakeup the timers
     *
     */
    resume() {
        this.currentNode.resume(this.currentItem);
    }
    restored() {
        this.path.forEach(item => {
            item.element.restored(item);
        });
    }
    getChildrenTokens() {
        const children = [];
        this.execution.tokens.forEach(token => {
            if (token.parentToken && (token.parentToken.id == this.id))
                children.push(token);
        });
        return children;
    }
    /*
     *  is called before Node execute and before an item is created
     *
     */
    preExecute() {
        return __awaiter(this, void 0, void 0, function* () {
            // loop
            return yield Loop_1.Loop.checkStart(this);
        });
    }
    /*
     * is called just before moving to next item in the flow
     */
    preNext() {
        return __awaiter(this, void 0, void 0, function* () {
            return yield Loop_1.Loop.checkNext(this);
        });
    }
    /**
     * this is the primary exectuion method for a token
     */
    execute(input) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!(yield this.preExecute()))
                return; // loop logic will take care of it
            let ret;
            const item = new Item_1.Item(this.currentNode, this);
            this.path.push(item);
            this.log('.executing item:' + this.currentNode.id + " " + item.id);
            if (input)
                yield this.currentNode.setInput(item, input);
            ret = yield this.currentNode.execute(item);
            /*
                    // check for subprocess
                    if (this.currentNode.type == 'bpmn:SubProcess') {
                        this.log('..executing a sub process item:' + this.currentNode.id + " " + item.id + " is done");
                        const subProcess = this.currentNode as SubProcess;
                        const proc = subProcess.childProcess;
                        const startNode = proc.getStartNode();
            
                        const newToken = await Token.startNewToken(this.execution, startNode, null, this, this.currentNode, null);
            
                    }
            */
            this.log('..executing item:' + this.currentNode.id + " " + item.id + " is done");
            if (ret == __1.NODE_ACTION.wait) {
                this.status = __1.TOKEN_STATUS.wait;
                return; // goto sleep for now will call you by signal
            }
            const result = yield this.goNext();
            return result;
        });
    }
    applyInput(inputData) {
        this.execution.applyInput(inputData, this.dataPath);
    }
    /**
     *  is called by Gateways to cancel current token
     *
     * */
    terminate() {
        this.currentNode.end(this.currentItem);
        this.end();
    }
    /*
     *  is called to invoke an element like userTask, or trigger an envent or signal
     *
     */
    signal(data) {
        return __awaiter(this, void 0, void 0, function* () {
            // check if valid node and valid status
            // find the item
            const item = this.currentItem;
            this.log(`..token.invoke ${this.currentNode.id} ${this.currentNode.type}`);
            this.currentNode.setInput(item, data);
            if (item.status == __1.ITEM_STATUS.wait) {
                const ret = yield this.currentNode.run(item);
                let result = yield this.currentNode.continue(item);
                result = yield this.goNext();
            }
            else
                this.log(`*** ERROR===== invoking a type of  ${this.currentNode.type} with status of ${item.status}`);
            this.log(`..token.invoke ended ${this.currentNode.id} ${this.currentNode.type}`);
        });
    }
    /*
     *  is called to mark this token end
     */
    end() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.currentItem.status != __1.ITEM_STATUS.end)
                this.log('..**token ended but item is still ' + this.currentItem.status);
            this.status = __1.TOKEN_STATUS.end;
            this.execution.tokenEnded(this);
            // check if subprocess then continue parent
            if (this.branchNode && this.branchNode.type == 'bpmn:SubProcess') {
                this.log('..subprocess token has ended');
                yield this.parentToken.signal(null);
            }
        });
    }
    /*
     *  once node is completed the token will move to next action
     *
     */
    goNext() {
        return __awaiter(this, void 0, void 0, function* () {
            this.log(`..token.goNext ${this.currentNode.id} ${this.currentNode.type}`);
            if (!(yield this.preNext()))
                return;
            const outbounds = this.currentNode.getOutbounds(this.currentItem);
            if (outbounds.length == 0) {
                this.log('...no more outbounds - ending token ' + this.id);
                return yield this.end();
            }
            let thisNode = this.currentNode;
            const self = this;
            const promises = [];
            if (outbounds.length > 1) {
                this.end();
            }
            outbounds.forEach(function (flowItem) {
                return __awaiter(this, void 0, void 0, function* () {
                    /// need to check if next node is converging; therefore no new item``
                    flowItem.status = __1.ITEM_STATUS.end;
                    self.path.push(flowItem);
                    let nextNode = flowItem.element['to'];
                    self.log('...processing flow' + flowItem.element.id + " to " + nextNode.id);
                    if (nextNode) {
                        if (outbounds.length == 1) {
                            self.currentNode = nextNode;
                            promises.push(self.execute(null));
                        }
                        else {
                            promises.push(Token.startNewToken(self.execution, nextNode, null, self, thisNode, null));
                        }
                    }
                });
            });
            this.log(`... waiting for ${promises.length}`);
            yield Promise.all(promises);
            this.log(`..token.goNext is done ${this.currentNode.id} ${this.currentNode.type}`);
        });
    }
    log(msg) {
        this.execution.log(msg);
    }
}
exports.Token = Token;
//# sourceMappingURL=Token.js.map