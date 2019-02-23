/*jshint esversion: 6 */
/**
 * Nextcloud - cospend
 *
 *
 * This file is licensed under the Affero General Public License version 3 or
 * later. See the COPYING file.
 *
 * @author Julien Veyssier <eneiluj@posteo.net>
 * @copyright Julien Veyssier 2019
 */
(function ($, OC) {
    'use strict';

    //////////////// VAR DEFINITION /////////////////////
    var MEMBER_NAME_EDITION = 1;
    var MEMBER_WEIGHT_EDITION = 2;

    var PROJECT_NAME_EDITION = 1;
    var PROJECT_PASSWORD_EDITION = 2;

    var cospend = {
        restoredSelectedProjectId: null,
        memberEditionMode: null,
        projectEditionMode: null,
        projectDeletionTimer: {},
        billDeletionTimer: {},
        // indexed by projectid, then by billid
        bills: {},
        // indexed by projectid, then by memberid
        members: {},
        projects: {},
        currentProjectId: null
    };

    //////////////// UTILS /////////////////////

    function getLetterColor(letter1, letter2) {
        var letter1Index = letter1.toLowerCase().charCodeAt(0);
        var letter2Index = letter2.toLowerCase().charCodeAt(0);
        var letterCoef = (letter1Index * letter2Index) % 100 / 100;
        var h = letterCoef * 360;
        var s = 45 + letterCoef * 10;
        var l = 50 + letterCoef * 10;
        return {h: Math.round(h), s: Math.round(s), l: Math.round(l)};
    }

    function hslToRgb(h, s, l) {
        var r, g, b;

        if(s == 0){
            r = g = b = l; // achromatic
        }else{
            var hue2rgb = function hue2rgb(p, q, t){
                if(t < 0) t += 1;
                if(t > 1) t -= 1;
                if(t < 1/6) return p + (q - p) * 6 * t;
                if(t < 1/2) return q;
                if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            }

            var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            var p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }

        //return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
        //return {r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255)};
        var rgb = {r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255)};
        var hexStringR = rgb.r.toString(16);
        if (hexStringR.length % 2) {
            hexStringR = '0' + hexStringR;
        }
        var hexStringG = rgb.g.toString(16);
        if (hexStringG.length % 2) {
            hexStringG = '0' + hexStringG;
        }
        var hexStringB = rgb.b.toString(16);
        if (hexStringB.length % 2) {
            hexStringB = '0' + hexStringB;
        }
        //console.log('r:'+hexStringR+' g:'+hexStringG+' b:'+hexStringB);
        //console.log('rr:'+rgb.r+' gg:'+rgb.g+' bb:'+rgb.b);
        return hexStringR+hexStringG+hexStringB;
    }

    function Timer(callback, mydelay) {
        var timerId, start, remaining = mydelay;

        this.pause = function() {
            window.clearTimeout(timerId);
            remaining -= new Date() - start;
        };

        this.resume = function() {
            start = new Date();
            window.clearTimeout(timerId);
            timerId = window.setTimeout(callback, remaining);
        };

        this.resume();
    }

    var mytimer = 0;
    function delay(callback, ms) {
        return function() {
            var context = this, args = arguments;
            clearTimeout(mytimer);
            mytimer = setTimeout(function () {
                callback.apply(context, args);
            }, ms || 0);
        };
    }

    function pad(n) {
        return (n < 10) ? ('0' + n) : n;
    }

    function endsWith(str, suffix) {
        return str.indexOf(suffix, str.length - suffix.length) !== -1;
    }

    function basename(str) {
        var base = String(str).substring(str.lastIndexOf('/') + 1);
        if (base.lastIndexOf(".") !== -1) {
            base = base.substring(0, base.lastIndexOf("."));
        }
        return base;
    }

    var undoDeleteBillStyle = 'opacity:1; background-image: url('+OC.generateUrl('/svg/core/actions/history?color=2AB4FF')+');';

    /*
     * get key events
     */
    function checkKey(e) {
        e = e || window.event;
        var kc = e.keyCode;
        //console.log(kc);

        // key '<'
        if (kc === 60 || kc === 220) {
            e.preventDefault();
        }

        if (e.key === 'Escape') {
        }
    }

    function createProject(id, name, password) {
        $('#createproject').addClass('icon-loading-small');
        var req = {
            id: id,
            name: name,
            password: password
        };
        var url = OC.generateUrl('/apps/cospend/createProject');
        $.ajax({
            type: 'POST',
            url: url,
            data: req,
            async: true,
        }).done(function (response) {
            addProject({
                id: id,
                name: name,
                contact_email: '',
                members: [],
                active_members: [],
                balance: {}
            });

            var div = $('#newprojectdiv');
            $('#newprojectbutton').removeClass('icon-triangle-s').addClass('icon-triangle-e');
            div.slideUp('slow', function() {
                $('#newBillButton').fadeIn();
            });
            // select created project
            selectProject($('.projectitem[projectid='+id+']'));
        }).always(function() {
            $('#createproject').removeClass('icon-loading-small');
        }).fail(function(response) {
            OC.Notification.showTemporary(t('cospend', 'Failed to create project') + ' ' + response.responseText);
        });
    }

    function createMember(projectid, name) {
        $('.projectitem[projectid='+projectid+']').addClass('icon-loading-small');
        var req = {
            name: name
        };
        var url;
        if (!cospend.pageIsPublic) {
            req.projectid = projectid;
            url = OC.generateUrl('/apps/cospend/addMember');
        }
        else {
            url = OC.generateUrl('/apps/cospend/api/projects/'+cospend.projectid+'/'+cospend.password+'/members');
        }
        $.ajax({
            type: 'POST',
            url: url,
            data: req,
            async: true,
        }).done(function (response) {
            var member = {
                id: response,
                name: name,
                weight: 1,
                activated: true
            };
            // add member to UI
            addMember(projectid, member, 0);
            // fold new member form
            $('.newmemberdiv').slideUp();
            updateNumberOfMember(projectid);
            $('#billdetail').html('');
            OC.Notification.showTemporary(t('cospend', 'Created member {name}', {name: name}));
        }).always(function() {
            $('.projectitem[projectid='+projectid+']').removeClass('icon-loading-small');
        }).fail(function(response) {
            OC.Notification.showTemporary(t('cospend', 'Failed to add member') + ' ' + response.responseText);
        });
    }

    function editMember(projectid, memberid, newName, newWeight, newActivated) {
        $('.projectitem[projectid='+projectid+'] ul.memberlist > li[memberid='+memberid+']')
            .addClass('icon-loading-small')
            .removeClass('editing');
        var req = {
            name: newName,
            weight: newWeight,
            activated: newActivated
        };
        var url, type;
        if (!cospend.pageIsPublic) {
            req.projectid = projectid;
            req.memberid = memberid;
            url = OC.generateUrl('/apps/cospend/editMember');
            type = 'POST';
        }
        else {
            url = OC.generateUrl('/apps/cospend/api/projects/'+cospend.projectid+'/'+cospend.password+'/members/'+memberid);
            type = 'PUT';
        }
        $.ajax({
            type: type,
            url: url,
            data: req,
            async: true,
        }).done(function (response) {
            var memberLine = $('.projectitem[projectid='+projectid+'] ul.memberlist > li[memberid='+memberid+']');
            // update member values
            if (newName) {
                memberLine.find('b.memberName').text(newName);
                cospend.members[projectid][memberid].name = newName;
            }
            if (newWeight) {
                memberLine.find('b.memberWeight').text(newWeight);
                cospend.members[projectid][memberid].weight = newWeight;
                updateProjectBalances(projectid);
            }
            if (newActivated !== null && newActivated === false) {
                memberLine.find('>a').removeClass('icon-user').addClass('icon-disabled-user');
                memberLine.find('.toggleMember span').first().removeClass('icon-delete').addClass('icon-history');
                memberLine.find('.toggleMember span').eq(1).text(t('cospend', 'Reactivate'));
                cospend.members[projectid][memberid].activated = newActivated;
            }
            else if (newActivated !== null && newActivated === true) {
                memberLine.find('>a').removeClass('icon-disabled-user').addClass('icon-user');
                memberLine.find('.toggleMember span').first().removeClass('icon-history').addClass('icon-delete');
                memberLine.find('.toggleMember span').eq(1).text(t('cospend', 'Deactivate'));
                cospend.members[projectid][memberid].activated = newActivated;
            }
            // anyway : update icon
            var c = getMemberColor(cospend.members[projectid][memberid].name);
            var rgbC = hslToRgb(c.h/360, c.s/100, c.l/100);
            var imgurl;
            if (cospend.members[projectid][memberid].activated) {
                imgurl = OC.generateUrl('/svg/core/actions/user?color='+rgbC);
            }
            else {
                imgurl = OC.generateUrl('/svg/core/actions/disabled-user?color='+rgbC);
            }
            memberLine.find('>a').attr('style', 'background-image: url('+imgurl+')');
            OC.Notification.showTemporary(t('cospend', 'Saved member'));
            // get bills again to refresh names
            getBills(projectid);
            // reset bill edition
            $('#billdetail').html('');
        }).always(function() {
            $('.projectitem[projectid='+projectid+'] ul.memberlist > li[memberid='+memberid+']').removeClass('icon-loading-small');
        }).fail(function(response) {
            OC.Notification.showTemporary(t('cospend', 'Failed to save member') + ' ' + response.responseText);
        });
    }

    function createBill(projectid, what, amount, payer_id, date, owerIds, repeat, custom=false) {
        $('.loading-bill').addClass('icon-loading-small');
        var req = {
            what: what,
            date: date,
            payer: payer_id,
            payed_for: owerIds.join(','),
            amount: amount,
            repeat: repeat
        };
        var url, type;
        if (!cospend.pageIsPublic) {
            req.projectid = projectid;
            url = OC.generateUrl('/apps/cospend/addBill');
        }
        else {
            url = OC.generateUrl('/apps/cospend/api/projects/'+cospend.projectid+'/'+cospend.password+'/bills');
        }
        $.ajax({
            type: 'POST',
            url: url,
            data: req,
            async: true,
        }).done(function (response) {
            var billid = response;
            // update dict
            cospend.bills[projectid][billid] = {
                id: billid,
                what: what,
                date: date,
                amount: amount,
                payer_id: payer_id,
                repeat: repeat
            };
            var billOwers = [];
            for (var i=0; i < owerIds.length; i++) {
                billOwers.push({id: owerIds[i]});
            }
            cospend.bills[projectid][billid].owers = billOwers;

            // update ui
            var bill = cospend.bills[projectid][billid];
            if (!custom) {
                updateBillItem(projectid, 0, bill);
                updateDisplayedBill(projectid, billid, what, payer_id, repeat);
            }
            else {
                addBill(projectid, bill);
            }

            updateProjectBalances(projectid);

            OC.Notification.showTemporary(t('cospend', 'Bill created'));
        }).always(function() {
            $('.loading-bill').removeClass('icon-loading-small');
        }).fail(function(response) {
            OC.Notification.showTemporary(t('cospend', 'Failed to create bill') + ' ' + response.responseText);
        });
    }

    function saveBill(projectid, billid, what, amount, payer_id, date, owerIds, repeat) {
        $('.loading-bill').addClass('icon-loading-small');
        var req = {
            what: what,
            date: date,
            payer: payer_id,
            payed_for: owerIds.join(','),
            amount: amount,
            repeat: repeat
        };
        var url, type;
        if (!cospend.pageIsPublic) {
            req.projectid = projectid;
            req.billid = billid;
            type = 'POST';
            url = OC.generateUrl('/apps/cospend/editBill');
        }
        else {
            type = 'PUT';
            url = OC.generateUrl('/apps/cospend/api/projects/'+cospend.projectid+'/'+cospend.password+'/bills/'+billid);
        }
        $.ajax({
            type: type,
            url: url,
            data: req,
            async: true,
        }).done(function (response) {
            // update dict
            cospend.bills[projectid][billid].what = what;
            cospend.bills[projectid][billid].date = date;
            cospend.bills[projectid][billid].amount = amount;
            cospend.bills[projectid][billid].payer_id = payer_id;
            cospend.bills[projectid][billid].repeat = repeat;
            var billOwers = [];
            for (var i=0; i < owerIds.length; i++) {
                billOwers.push({id: owerIds[i]});
            }
            cospend.bills[projectid][billid].owers = billOwers;

            // update ui
            var bill = cospend.bills[projectid][billid];
            updateBillItem(projectid, billid, bill);
            updateDisplayedBill(projectid, billid, what, payer_id, repeat);

            updateProjectBalances(projectid);

            OC.Notification.showTemporary(t('cospend', 'Saved bill'));
        }).always(function() {
            $('.loading-bill').removeClass('icon-loading-small');
        }).fail(function(response) {
            OC.Notification.showTemporary(
                t('cospend', 'Failed to save bill') +
                ' ' + response.responseText
            );
        });
    }

    function updateBillItem(projectid, billid, bill) {
        var billItem = $('.billitem[billid='+billid+']');

        var owerNames = '';
        var ower;
        for (var i=0; i < bill.owers.length; i++) {
            ower = bill.owers[i];
            owerNames = owerNames + getMemberName(projectid, ower.id) + ', ';
        }
        owerNames = owerNames.replace(/, $/, '');
        var memberName = getMemberName(projectid, bill.payer_id);
        var memberFirstLetter = memberName[0];

        var links = bill.what.match(/https?:\/\/[^\s]+/gi) || [];
        var formattedLinks = '';
        var linkChars = '';
        for (var i=0; i < links.length; i++) {
            formattedLinks = formattedLinks + '<a href="'+links[i]+'" target="blank">['+t('cospend', 'link')+']</a> ';
            linkChars = linkChars + '  🔗';
        }
        var repeatChar = '';
        if (bill.repeat !== 'n') {
            repeatChar = ' ⏩';
        }
        var whatFormatted = bill.what.replace(/https?:\/\/[^\s]+/gi, '') + linkChars + repeatChar;

        var title = whatFormatted + '\n' + bill.amount.toFixed(2) + '\n' +
            bill.date + '\n' + memberName + ' -> ' + owerNames;
        var c = getMemberColor(memberName);
        var item = '<a href="#" class="app-content-list-item billitem selectedbill" billid="'+bill.id+'" projectid="'+projectid+'" title="'+title+'">' +
            '<div class="app-content-list-item-icon" style="background-color: hsl('+c.h+', '+c.s+'%, '+c.l+'%);">'+memberFirstLetter+'</div>' +
            '<div class="app-content-list-item-line-one">'+whatFormatted+'</div>' +
            '<div class="app-content-list-item-line-two">'+bill.amount.toFixed(2)+' ('+memberName+' → '+owerNames+')</div>' +
            '<span class="app-content-list-item-details">'+bill.date+'</span>' +
            '<div class="icon-delete deleteBillIcon"></div>' +
            '<div class="icon-history undoDeleteBill" style="'+undoDeleteBillStyle+'" title="Undo"></div>' +
            '</a>';
        billItem.replaceWith(item);
    }

    function editProject(projectid, newName, newEmail, newPassword) {
        var req = {
            name: newName,
            contact_email: newEmail,
            password: newPassword
        };
        var url, type;
        if (!cospend.pageIsPublic) {
            req.projectid = projectid;
            type = 'POST';
            url = OC.generateUrl('/apps/cospend/editProject');
        }
        else {
            type = 'PUT';
            url = OC.generateUrl('/apps/cospend/api/projects/'+cospend.projectid+'/'+cospend.password);
        }
        $.ajax({
            type: type,
            url: url,
            data: req,
            async: true,
        }).done(function (response) {
            var projectLine = $('.projectitem[projectid='+projectid+']');
            // update project values
            if (newName) {
                projectLine.find('>a span').text(newName);
                cospend.projects[projectid].name = newName;
            }
            if (cospend.pageIsPublic && newPassword) {
                cospend.password = newPassword;
            }
            // update deleted text
            var projectName = cospend.projects[projectid].name;
            projectLine.find('.app-navigation-entry-deleted-description').text(
                t('cospend', 'Deleted {name}', {name: projectName})
            );
            // remove editing mode
            projectLine.removeClass('editing');
            // reset bill edition
            $('#billdetail').html('');
            OC.Notification.showTemporary(t('cospend', 'Saved project'));
        }).always(function() {
        }).fail(function(response) {
            OC.Notification.showTemporary(
                t('cospend', 'Failed to save project') +
                ' ' + response.responseText
            );
        });
    }

    function updateNumberOfMember(projectid) {
        var nbMembers = $('li.projectitem[projectid='+projectid+'] ul.memberlist > li').length;
        $('li.projectitem[projectid='+projectid+'] .app-navigation-entry-utils-counter span').text(nbMembers);
    }

    function deleteProject(id) {
        var req = {
        };
        var url, type;
        if (!cospend.pageIsPublic) {
            req.projectid = id
            url = OC.generateUrl('/apps/cospend/deleteProject');
            type = 'POST';
        }
        else {
            type = 'DELETE';
            url = OC.generateUrl('/apps/cospend/api/projects/'+cospend.projectid+'/'+cospend.password);
        }
        $.ajax({
            type: type,
            url: url,
            data: req,
            async: true,
        }).done(function (response) {
            $('.projectitem[projectid='+id+']').fadeOut('slow', function() {
                $(this).remove();
            });
            if (cospend.currentProjectId === id) {
                $('#bill-list').html('');
                $('#billdetail').html('');
            }
            if (cospend.pageIsPublic) {
                var redirectUrl = OC.generateUrl('/apps/cospend/login');
                window.location.replace(redirectUrl);
            }
            OC.Notification.showTemporary(t('cospend', 'Deleted project {id}', {id: id}));
        }).always(function() {
        }).fail(function(response) {
            OC.Notification.showTemporary(t('cospend', 'Failed to delete project') + ' ' + response.responseText);
        });
    }

    function deleteBill(projectid, billid) {
        var req = {
        };
        var url, type;
        if (!cospend.pageIsPublic) {
            req.projectid = projectid;
            req.billid = billid;
            type = 'POST';
            url = OC.generateUrl('/apps/cospend/deleteBill');
        }
        else {
            type = 'DELETE';
            url = OC.generateUrl('/apps/cospend/api/projects/'+cospend.projectid+'/'+cospend.password+'/bills/'+billid);
        }
        $.ajax({
            type: type,
            url: url,
            data: req,
            async: true,
        }).done(function (response) {
            // if the deleted bill was displayed in details, empty detail
            if ($('#billdetail .bill-title').length > 0 && $('#billdetail .bill-title').attr('billid') === billid) {
                $('#billdetail').html('');
            }
            $('.billitem[billid='+billid+']').fadeOut('slow', function() {
                $(this).remove();
                if ($('.billitem').length === 0) {
                    $('#bill-list').html('<h2 class="nobill">'+t('cospend', 'No bill yet')+'</h2>');
                }
            });
            delete cospend.bills[projectid][billid];
            updateProjectBalances(projectid);
            OC.Notification.showTemporary(t('cospend', 'Deleted bill'));
        }).always(function() {
        }).fail(function(response) {
            OC.Notification.showTemporary(t('cospend', 'Failed to delete bill') + ' ' + response.responseText);
        });
    }

    function getProjects() {
        var req = {
        };
        var url;
        var type;
        if (!cospend.pageIsPublic) {
            url = OC.generateUrl('/apps/cospend/getProjects');
            type = 'POST';
        }
        else {
            url = OC.generateUrl('/apps/cospend/api/projects/'+cospend.projectid+'/'+cospend.password);
            type = 'GET';
        }
        cospend.currentGetProjectsAjax = $.ajax({
            type: type,
            url: url,
            data: req,
            async: true,
            xhr: function() {
                var xhr = new window.XMLHttpRequest();
                xhr.addEventListener('progress', function(evt) {
                    if (evt.lengthComputable) {
                        var percentComplete = evt.loaded / evt.total * 100;
                        //$('#loadingpc').text(parseInt(percentComplete) + '%');
                    }
                }, false);

                return xhr;
            }
        }).done(function (response) {
            if (!cospend.pageIsPublic) {
                $('.projectitem').remove();
                $('#bill-list').html('');
                cospend.bills = {};
                cospend.members = {};
                cospend.projects = {};
                for (var i = 0; i < response.length; i++) {
                    addProject(response[i]);
                }
            }
            else {
                addProject(response);
                $('.projectitem').addClass('open');
                cospend.currentProjectId = cospend.projectid;
                getBills(cospend.projectid);
            }
        }).always(function() {
            cospend.currentGetProjectsAjax = null;
        }).fail(function() {
            OC.Notification.showTemporary(t('cospend', 'Failed to get projects'));
        });
    }

    function getProjectStatistics(projectid) {
        $('#billdetail').html('<h2 class="icon-loading-small"></h2>');
        var req = {
        };
        var url;
        var type;
        if (!cospend.pageIsPublic) {
            req.projectid = projectid;
            type = 'POST';
            url = OC.generateUrl('/apps/cospend/getStatistics');
        }
        else {
            type = 'GET';
            url = OC.generateUrl('/apps/cospend/api/projects/'+cospend.projectid+'/'+cospend.password+'/statistics');
        }
        cospend.currentGetProjectsAjax = $.ajax({
            type: type,
            url: url,
            data: req,
            async: true,
        }).done(function (response) {
            displayStatistics(projectid, response);
        }).always(function() {
        }).fail(function() {
            OC.Notification.showTemporary(t('cospend', 'Failed to get statistics'));
            $('#billdetail').html('');
        });
    }

    function getProjectSettlement(projectid) {
        $('#billdetail').html('<h2 class="icon-loading-small"></h2>');
        var req = {
        };
        var url;
        var type;
        if (!cospend.pageIsPublic) {
            req.projectid = projectid;
            type = 'POST';
            url = OC.generateUrl('/apps/cospend/getSettlement');
        }
        else {
            type = 'GET';
            url = OC.generateUrl('/apps/cospend/api/projects/'+cospend.projectid+'/'+cospend.password+'/settle');
        }
        cospend.currentGetProjectsAjax = $.ajax({
            type: type,
            url: url,
            data: req,
            async: true,
        }).done(function (response) {
            displaySettlement(projectid, response);
        }).always(function() {
        }).fail(function() {
            OC.Notification.showTemporary(t('cospend', 'Failed to get settlement'));
            $('#billdetail').html('');
        });
    }

    function displaySettlement(projectid, transactionList) {
        // unselect bill
        $('.billitem').removeClass('selectedbill');

        var projectName = getProjectName(projectid);
        $('#billdetail').html('');
        $('.app-content-list').addClass('showdetails');
        var titleStr = t('cospend', 'Settlement of project {name}', {name: projectName});
        var fromStr = t('cospend', 'Who pays?');
        var toStr = t('cospend', 'To whom?');
        var howMuchStr = t('cospend', 'How much?');
        var exportStr = '';
        if (!cospend.pageIsPublic) {
            exportStr = ' <button class="exportSettlement" projectid="'+projectid+'"><span class="icon-file"></span>'+t('cospend', 'Export')+'</button>';
        }
        var autoSettleStr = ' <button class="autoSettlement" projectid="'+projectid+'"><span class="icon-play"></span>'+t('cospend', 'Add these payments to project')+'</button>';
        var settlementStr = '<div id="app-details-toggle" tabindex="0" class="icon-confirm"></div>' +
            '<h2 id="settlementTitle"><span class="icon-category-organization"></span>'+titleStr+exportStr+autoSettleStr+'</h2>' +
            '<table id="settlementTable"><thead>' +
            '<th>'+fromStr+'</th>' +
            '<th>'+toStr+'</th>' +
            '<th>'+howMuchStr+'</th>' +
            '</thead>';
        var whoPaysName, toWhomName, amount;
        for (var i=0; i < transactionList.length; i++) {
            amount = transactionList[i].amount.toFixed(2);
            whoPaysName = getMemberName(projectid, transactionList[i].from);
            toWhomName = getMemberName(projectid, transactionList[i].to);
            settlementStr = settlementStr +
                '<tr>' +
                '<td>'+whoPaysName+'</td>' +
                '<td>'+toWhomName+'</td>' +
                '<td>'+amount+'</td>' +
                '</tr>';
        }
        settlementStr = settlementStr + '</table>';
        $('#billdetail').html(settlementStr);
    }

    function displayStatistics(projectid, statList) {
        // unselect bill
        $('.billitem').removeClass('selectedbill');

        var projectName = getProjectName(projectid);
        $('#billdetail').html('');
        $('.app-content-list').addClass('showdetails');
        var titleStr = t('cospend', 'Statistics of project {name}', {name: projectName});
        var nameStr = t('cospend', 'Member name');
        var paidStr = t('cospend', 'Paid');
        var spentStr = t('cospend', 'Spent');
        var balanceStr = t('cospend', 'Balance');
        var exportStr = '';
        if (!cospend.pageIsPublic) {
            exportStr = ' <button class="exportStats" projectid="'+projectid+'"><span class="icon-file"></span>'+t('cospend', 'Export')+'</button>';
        }
        var statsStr = '<div id="app-details-toggle" tabindex="0" class="icon-confirm"></div>' +
            '<h2 id="statsTitle"><span class="icon-category-monitoring"></span>'+titleStr+exportStr+'</h2>' +
            '<table id="statsTable"><thead>' +
            '<th>'+nameStr+'</th>' +
            '<th>'+paidStr+'</th>' +
            '<th>'+spentStr+'</th>' +
            '<th>'+balanceStr+'</th>' +
            '</thead>';
        var paid, spent, balance, name, balanceClass;
        for (var i=0; i < statList.length; i++) {
            balanceClass = '';
            if (statList[i].balance > 0) {
                balanceClass = ' class="balancePositive"';
            }
            else if (statList[i].balance < 0) {
                balanceClass = ' class="balanceNegative"';
            }
            paid = statList[i].paid.toFixed(2);
            spent = statList[i].spent.toFixed(2);
            balance = statList[i].balance.toFixed(2);
            name = statList[i].member.name;
            statsStr = statsStr +
                '<tr>' +
                '<td>'+name+'</td>' +
                '<td>'+paid+'</td>' +
                '<td>'+spent+'</td>' +
                '<td'+balanceClass+'>'+balance+'</td>' +
                '</tr>';
        }
        statsStr = statsStr + '</table>';
        $('#billdetail').html(statsStr);
    }

    function getBills(projectid) {
        $('#bill-list').html('<h2 class="icon-loading-small"></h2>');
        var req = {};
        var url;
        var type;
        if (!cospend.pageIsPublic) {
            url = OC.generateUrl('/apps/cospend/getBills');
            type = 'POST';
            req.projectid = projectid;
        }
        else {
            url = OC.generateUrl('/apps/cospend/api/projects/'+cospend.projectid+'/'+cospend.password+'/bills');
            type = 'GET';
        }
        cospend.currentGetProjectsAjax = $.ajax({
            type: type,
            url: url,
            data: req,
            async: true,
        }).done(function (response) {
            $('#bill-list').html('');
            cospend.bills[projectid] = {};
            if (response.length > 0) {
                var bill;
                for (var i = 0; i < response.length; i++) {
                    bill = response[i];
                    addBill(projectid, bill);
                }
            }
            else {
                $('#bill-list').html('<h2 class="nobill">'+t('cospend', 'No bill yet')+'</h2>');
            }
        }).always(function() {
        }).fail(function() {
            OC.Notification.showTemporary(t('cospend', 'Failed to get bills'));
            $('#bill-list').html('');
        });
    }

    function getProjectName(projectid) {
        return cospend.projects[projectid].name;
    }

    function updateDisplayedBill(projectid, billid, what, payer_id, repeat) {
        var projectName = getProjectName(projectid);
        $('.bill-title').attr('billid', billid);
        var c = {h: 0, s: 0, l: 50};
        if (billid !== 0) {
            $('#owerCustomAmount').hide();
            var payerName = getMemberName(projectid, payer_id);
            c = getMemberColor(payerName);
        }

        var links = what.match(/https?:\/\/[^\s]+/gi) || [];
        var formattedLinks = '';
        for (var i=0; i < links.length; i++) {
            formattedLinks = formattedLinks + '<a href="'+links[i]+'" target="blank">[🔗 '+t('cospend', 'link')+']</a> ';
        }
        var repeatChar = '';
        if (repeat !== 'n') {
            repeatChar = ' ⏩';
        }
        var whatFormatted = what.replace(/https?:\/\/[^\s]+/gi, '') + repeatChar;
        $('.bill-title').html(
            '<span class="loading-bill"></span>' +
            '<span class="icon-edit-white"></span>' +
            t('cospend', 'Bill : {what}', {what: whatFormatted}) +
            ' ' + formattedLinks
        );
        $('.bill-title').attr('style', 'background-color: hsl('+c.h+', '+c.s+'%, '+c.l+'%);');
    }

    function displayBill(projectid, billid) {
        // select bill item
        $('.billitem').removeClass('selectedbill');
        $('.billitem[billid='+billid+']').addClass('selectedbill');

        var bill = cospend.bills[projectid][billid];
        var projectName = getProjectName(projectid);

        var owers = bill.owers;
        var owerIds = [];
        for (var i=0; i < owers.length; i++) {
            owerIds.push(owers[i].id);
        }

        var c = {h: 0, s: 0, l: 50};
        var owerCheckboxes = '';
        var payerOptions = '';
        var member;
        var selected, checked, readonly;
        for (var memberid in cospend.members[projectid]) {
            member = cospend.members[projectid][memberid];
            // payer
            selected = '';
            if (member.id === bill.payer_id) {
                selected = ' selected';
            }
            // show member if it's the payer or if it's activated
            if (member.activated || member.id === bill.payer_id) {
                payerOptions = payerOptions + '<option value="'+member.id+'"'+selected+'>'+member.name+'</option>';
            }
            // owers
            checked = '';
            if (owerIds.indexOf(member.id) !== -1) {
                checked = ' checked';
            }
            readonly = '';
            if (!member.activated) {
                readonly = ' disabled';
            }
            // show member if it's an ower or if it's activated
            if (member.activated || owerIds.indexOf(member.id) !== -1) {
                owerCheckboxes = owerCheckboxes +
                    '<div class="owerEntry">' +
                    '<input id="amount'+projectid+member.id+'" owerid="'+member.id+'" class="customamountinput" type="number" value="" step="0.01" min="0"/>' +
                    '<label for="amount'+projectid+member.id+'" class="numberlabel">'+member.name+'</label>' +
                    '<input id="'+projectid+member.id+'" owerid="'+member.id+'" class="checkbox" type="checkbox"'+checked+readonly+'/>' +
                    '<label for="'+projectid+member.id+'" class="checkboxlabel">'+member.name+'</label>' +
                    '</div>';
            }
        }
        var payerDisabled = '';
        if (billid !== 0) {
            // disable payer select if bill is not new
            if (!cospend.members[projectid][bill.payer_id].activated) {
                payerDisabled = ' disabled';
            }
            var payerName = getMemberName(projectid, bill.payer_id);
            c = getMemberColor(payerName);
        }
        $('#billdetail').html('');
        $('.app-content-list').addClass('showdetails');
        var whatStr = t('cospend', 'What?');
        var amountStr = t('cospend', 'How much?');
        var payerStr = t('cospend', 'Who payed?');
        var dateStr = t('cospend', 'When?');
        var owersStr = t('cospend', 'For whom?');

        var links = bill.what.match(/https?:\/\/[^\s]+/gi) || [];
        var formattedLinks = '';
        for (var i=0; i < links.length; i++) {
            formattedLinks = formattedLinks + '<a href="'+links[i]+'" target="blank">[🔗 '+t('cospend', 'link')+']</a> ';
        }
        var repeatChar = '';
        if (bill.repeat !== 'n') {
            repeatChar = ' ⏩';
        }
        var whatFormatted = bill.what.replace(/https?:\/\/[^\s]+/gi, '') + repeatChar;
        var titleStr = t('cospend', 'Bill : {what}', {what: whatFormatted});

        var allStr = t('cospend', 'All');
        var noneStr = t('cospend', 'None');
        var customAmountStr = t('cospend', 'Custom amount per member');
        var customAmountValidateStr = t('cospend', 'Create bills');
        var addFileLinkText = t('cospend', 'Attach public link to personal file');

        var addFileHtml = '';
        if (!cospend.pageIsPublic) {
            addFileHtml = '<button id="addFileLinkButton"><span class="icon-public"></span>'+addFileLinkText+'</button>';
        }

        var detail =
            '<div id="app-details-toggle" tabindex="0" class="icon-confirm"></div>' +
            '<h2 class="bill-title" projectid="'+projectid+'" billid="'+bill.id+'" style="background-color: hsl('+c.h+', '+c.s+'%, '+c.l+'%);">' +
            '    <span class="loading-bill"></span>' +
            '    <span class="icon-edit-white"></span>'+titleStr+' '+formattedLinks +
            '</h2>' +
            '<div class="bill-form">' +
            '    <div class="bill-left">' +
            '        <div class="bill-what">' +
            '            <label for="what">' +
            '                <a class="icon icon-tag"></a>' +
            '                '+whatStr+
            '            </label>' +
            '            <input type="text" id="what" class="input-bill-what" value="'+bill.what+'"/>' +
            '        </div>' + addFileHtml +
            '        <div class="bill-amount">' +
            '            <label for="amount">' +
            '                <a class="icon icon-quota"></a>' +
            '                '+amountStr+
            '            </label>' +
            '            <input type="number" id="amount" class="input-bill-amount" value="'+bill.amount+'" step="0.01" min="0"/>' +
            '        </div>' +
            '        <div class="bill-payer">' +
            '            <label for="payer">' +
            '                <a class="icon icon-user"></a>' +
            '                '+payerStr+
            '            </label>' +
            '            <select id="payer" class="input-bill-payer"'+payerDisabled+'>' +
            '                '+payerOptions+
            '            </select>' +
            '        </div>' +
            '        <div class="bill-date">' +
            '            <label for="date">' +
            '                <a class="icon icon-calendar-dark"></a>' +
            '                '+dateStr+
            '            </label>' +
            '            <input type="date" id="date" class="input-bill-date" value="'+bill.date+'"/>' +
            '            <label for="repeatbill">' +
            '                <a class="icon icon-play-next"></a>' +
            '                '+t('cospend', 'Repeat this bill every')+
            '            </label>' +
            '            <select id="repeatbill">' +
            '               <option value="n" selected>'+t('cospend', 'do not repeat')+'</option>' +
            '               <option value="d">'+t('cospend', 'day')+'</option>' +
            '               <option value="w">'+t('cospend', 'week')+'</option>' +
            '               <option value="m">'+t('cospend', 'month')+'</option>' +
            '               <option value="y">'+t('cospend', 'year')+'</option>' +
            '            </select>' +
            '        </div>' +
            '    </div>' +
            '    <div class="bill-right">' +
            '        <div class="bill-owers">' +
            '            <a class="icon icon-group"></a><span>'+owersStr+'</span>' +
            '            <div class="owerAllNoneDiv">' +
            '            <button id="owerCustomAmount"><span class="icon-settings-dark"></span> '+customAmountStr+'</button>' +
            '            <button id="owerCustomAmountValidate"><span class="icon-confirm"></span> '+customAmountValidateStr+'</button>' +
            '            <button id="owerAll">'+allStr+'</button>' +
            '            <button id="owerNone">'+noneStr+'</button>' +
            '            </div>' +
            '            '+owerCheckboxes +
            '        </div>' +
            '    </div>' +
            '</div>';

        $(detail).appendTo('#billdetail');
        $('#billdetail .input-bill-what').focus().select();
        if (billid !== 0) {
            $('#repeatbill').val(bill.repeat);
        }
        else {
            $('#owerCustomAmount').show();
        }
    }

    function getMemberName(projectid, memberid) {
        //var memberName = $('.projectitem[projectid='+projectid+'] .memberlist > li[memberid='+memberid+'] b.memberName').text();
        var memberName = cospend.members[projectid][memberid].name;
        return memberName;
    }

    function getMemberColor(memberName) {
        var memberFirstLetter = memberName[0];
        var memberSecondLetter = 'a';
        if (memberName.length > 1) {
            memberSecondLetter = memberName[1];
        }
        var c = getLetterColor(memberFirstLetter, memberSecondLetter);
        return c;
    }

    function reload(msg) {
        OC.Notification.showTemporary(msg);
        new Timer(function() {
            location.reload();
        }, 5000);
    }

    function addBill(projectid, bill) {
        cospend.bills[projectid][bill.id] = bill;

        var owerNames = '';
        var ower;
        for (var i=0; i < bill.owers.length; i++) {
            ower = bill.owers[i];
            if (!cospend.members[projectid].hasOwnProperty(ower.id)) {
                reload(t('cospend', 'Member list is not up to date. Reloading in 5 sec.'));
                return;
            }
            owerNames = owerNames + getMemberName(projectid, ower.id) + ', ';
        }
        owerNames = owerNames.replace(/, $/, '');
        var title = '';
        var memberName = '';
        var memberFirstLetter;
        var c;

        var links = bill.what.match(/https?:\/\/[^\s]+/gi) || [];
        var formattedLinks = '';
        var linkChars = '';
        for (var i=0; i < links.length; i++) {
            formattedLinks = formattedLinks + '<a href="'+links[i]+'" target="blank">['+t('cospend', 'link')+']</a> ';
            linkChars = linkChars + '  🔗';
        }
        var repeatChar = '';
        if (bill.id !== 0 && bill.repeat !== 'n') {
            repeatChar = ' ⏩';
        }
        var whatFormatted = bill.what.replace(/https?:\/\/[^\s]+/gi, '') + linkChars + repeatChar;

        if (bill.id !== 0) {
            if (!cospend.members[projectid].hasOwnProperty(bill.payer_id)) {
                reload(t('cospend', 'Member list is not up to date. Reloading in 5 sec.'));
                return;
            }
            memberName = getMemberName(projectid, bill.payer_id);
            memberFirstLetter = memberName[0];

            title = whatFormatted + '\n' + bill.amount.toFixed(2) + '\n' +
                bill.date + '\n' + memberName + ' → ' + owerNames;
            c = getMemberColor(memberName);
        }
        else {
            c = {h: 0, s: 0, l: 50};
            memberFirstLetter = '-';
        }
        var item = '<a href="#" class="app-content-list-item billitem" billid="'+bill.id+'" projectid="'+projectid+'" title="'+title+'">' +
            '<div class="app-content-list-item-icon" style="background-color: ' +
            'hsl('+c.h+', '+c.s+'%, '+c.l+'%);">'+memberFirstLetter+'</div>'+
            '<div class="app-content-list-item-line-one">'+whatFormatted+'</div>' +
            '<div class="app-content-list-item-line-two">'+bill.amount.toFixed(2)+' ('+memberName+' → '+owerNames+')</div>' +
            '<span class="app-content-list-item-details">'+bill.date+'</span>' +
            '<div class="icon-delete deleteBillIcon"></div>' +
            '<div class="icon-history undoDeleteBill" style="'+undoDeleteBillStyle+'" title="Undo"></div>' +
            '</a>';
        $(item).prependTo('.app-content-list');

        $('#bill-list .nobill').remove();
    }

    function updateProjectBalances(projectid) {
        var req = {
        };
        var url;
        var type;
        if (!cospend.pageIsPublic) {
            req.projectid = projectid;
            url = OC.generateUrl('/apps/cospend/getProjectInfo');
            type = 'POST';
        }
        else {
            url = OC.generateUrl('/apps/cospend/api/projects/'+cospend.projectid+'/'+cospend.password);
            type = 'GET';
        }
        cospend.currentGetProjectsAjax = $.ajax({
            type: type,
            url: url,
            data: req,
            async: true,
        }).done(function (response) {
            var balance, balanceField, balanceClass, balanceTxt;
            for (var memberid in response.balance) {
                balance = response.balance[memberid];
                balanceField = $('.projectitem[projectid='+projectid+'] .memberlist > li[memberid='+memberid+'] b.balance');
                balanceField.removeClass('balancePositive').removeClass('balanceNegative');
                // just in case make member visible
                $('.memberitem[memberid='+memberid+']').removeClass('invisibleMember');
                if (balance <= -0.01) {
                    balanceClass = 'balanceNegative';
                    balanceTxt = balance.toFixed(2);
                    balanceField.addClass(balanceClass).text(balanceTxt);
                }
                else if (balance >= 0.01) {
                    balanceClass = 'balancePositive';
                    balanceTxt = '+' + balance.toFixed(2);
                    balanceField.addClass(balanceClass).text(balanceTxt);
                }
                else {
                    balanceField.text('0.00');
                    // hide member if balance == 0 and disabled
                    if (!cospend.members[projectid][memberid].activated) {
                        $('.memberitem[memberid='+memberid+']').addClass('invisibleMember');
                    }
                }
            }
        }).always(function() {
        }).fail(function() {
            OC.Notification.showTemporary(t('cospend', 'Failed to update balances'));
        });
    }

    function addProject(project) {
        cospend.projects[project.id] = project;
        cospend.members[project.id] = {};

        var name = project.name;
        var projectid = project.id;
        var addMemberStr = t('cospend', 'Add member');
        var guestAccessStr = t('cospend', 'Guest access link');
        var renameStr = t('cospend', 'Rename');
        var changePwdStr = t('cospend', 'Change password');
        var displayStatsStr = t('cospend', 'Display statistics');
        var settleStr = t('cospend', 'Settle the project');
        var exportStr = t('cospend', 'Export to csv');
        var deleteStr = t('cospend', 'Delete');
        var deletedStr = t('cospend', 'Deleted {name}', {name: name});
        var extProjUrl = OC.generateUrl('/apps/cospend/loginproject/'+projectid);
        var shareTitle = t('cospend', 'Press enter to validate');
        extProjUrl = window.location.protocol + '//' + window.location.hostname + extProjUrl;
        var li =
            '<li class="projectitem collapsible" projectid="'+projectid+'">' +
            '    <a class="icon-folder" href="#" title="'+projectid+'">' +
            '        <span>'+name+'</span>' +
            '    </a>' +
            '    <div class="app-navigation-entry-utils">' +
            '        <ul>' +
            '            <li class="app-navigation-entry-utils-counter"><span>'+project.members.length+'</span></li>' +
            '            <li class="app-navigation-entry-utils-menu-button shareProjectButton">' +
            '                <button class="icon-share"></button>' +
            '            </li>' +
            '            <li class="app-navigation-entry-utils-menu-button projectMenuButton">' +
            '                <button></button>' +
            '            </li>' +
            '        </ul>' +
            '    </div>' +
            '    <div class="app-navigation-entry-edit">' +
            '        <div>' +
            '            <input type="text" value="'+project.name+'" class="editProjectInput">' +
            '            <input type="submit" value="" class="icon-close editProjectClose">' +
            '            <input type="submit" value="" class="icon-checkmark editProjectOk">' +
            '        </div>' +
            '    </div>' +
            '    <ul class="app-navigation-entry-share">' +
            '        <li class="shareinputli" title="'+shareTitle+'"><input type="text" class="shareinput"/></li>' +
            '    </ul>' +

            '    <div class="newmemberdiv">' +
            '        <input class="newmembername" type="text" value=""/>' +
            '        <button class="newmemberbutton icon-add"></button>' +
            '    </div>' +

            '    <div class="app-navigation-entry-menu">' +
            '        <ul>' +
            '            <li>' +
            '                <a href="#" class="addMember">' +
            '                    <span class="icon-add"></span>' +
            '                    <span>'+addMemberStr+'</span>' +
            '                </a>' +
            '            </li>' +
            '            <li>' +
            '                <a href="#" class="copyExtProjectUrl" title="'+extProjUrl+'">' +
            '                    <span class="icon-clippy"></span>' +
            '                    <span>'+guestAccessStr+'</span>' +
            '                </a>' +
            '            </li>' +
            '            <li>' +
            '                <a href="#" class="editProjectName">' +
            '                    <span class="icon-rename"></span>' +
            '                    <span>'+renameStr+'</span>' +
            '                </a>' +
            '            </li>' +
            '            <li>' +
            '                <a href="#" class="editProjectPassword">' +
            '                    <span class="icon-rename"></span>' +
            '                    <span>'+changePwdStr+'</span>' +
            '                </a>' +
            '            </li>' +
            '            <li>' +
            '                <a href="#" class="getProjectStats">' +
            '                    <span class="icon-category-monitoring"></span>' +
            '                    <span>'+displayStatsStr+'</span>' +
            '                </a>' +
            '            </li>' +
            '            <li>' +
            '                <a href="#" class="getProjectSettlement">' +
            '                    <span class="icon-category-organization"></span>' +
            '                    <span>'+settleStr+'</span>' +
            '                </a>' +
            '            </li>' +
            '            <li>' +
            '                <a href="#" class="exportProject">' +
            '                    <span class="icon-category-office"></span>' +
            '                    <span>'+exportStr+'</span>' +
            '                </a>' +
            '            </li>' +
            '            <li>' +
            '                <a href="#" class="deleteProject">' +
            '                    <span class="icon-delete"></span>' +
            '                    <span>'+deleteStr+'</span>' +
            '                </a>' +
            '            </li>' +
            '        </ul>' +
            '    </div>' +
            '    <div class="app-navigation-entry-deleted">' +
            '        <div class="app-navigation-entry-deleted-description">'+deletedStr+'</div>' +
            '        <button class="app-navigation-entry-deleted-button icon-history undoDeleteProject" title="Undo"></button>' +
            '    </div>' +
            '    <ul class="memberlist"></ul>' +
            '</li>';

        $(li).appendTo('#projectlist');

        // select project if it was the last selected (option restore on page load)
        if (cospend.restoredSelectedProjectId === projectid) {
            selectProject($('.projectitem[projectid='+projectid+']'));
        }

        if (cospend.pageIsPublic) {
            $('.projectitem[projectid='+projectid+'] .shareProjectButton').hide();
            $('.projectitem[projectid='+projectid+'] .exportProject').parent().hide();
        }

        for (var i=0; i < project.members.length; i++) {
            var memberId = project.members[i].id;
            addMember(projectid, project.members[i], project.balance[memberId]);
        }

        if (project.shares) {
            for (var i=0; i < project.shares.length; i++) {
                var userid = project.shares[i].userid;
                var username = project.shares[i].name;
                addUserShare(projectid, userid, username);
            }
        }

        // set selected project
        if (cospend.restoredSelectedProjectId === projectid) {
            $('.projectitem').removeClass('selectedproject');
            $('.projectitem[projectid='+projectid+']').addClass('selectedproject');
            $('.app-navigation-entry-utils-counter').removeClass('highlighted');
            $('.projectitem[projectid='+projectid+'] .app-navigation-entry-utils-counter').addClass('highlighted');
        }
    }

    function addMember(projectid, member, balance) {
        // add member to dict
        cospend.members[projectid][member.id] = member;

        var invisibleClass = '';
        var balanceStr;
        if (balance >= 0.01) {
            balanceStr = '<b class="balance balancePositive">+'+balance.toFixed(2)+'</b>';
        }
        else if (balance <= -0.01) {
            balanceStr = '<b class="balance balanceNegative">'+balance.toFixed(2)+'</b>';
        }
        else {
            balanceStr = '<b class="balance">0.00</b>';
            if (!member.activated) {
                invisibleClass = ' invisibleMember';
            }
        }
        var iconStr, iconToggleStr, toggleStr, imgurl;
        var c = getMemberColor(member.name);
        var rgbC = hslToRgb(c.h/360, c.s/100, c.l/100);
        if (member.activated) {
            iconStr = 'icon-user';
            iconToggleStr = 'icon-delete';
            toggleStr = t('cospend', 'Deactivate');
            imgurl = OC.generateUrl('/svg/core/actions/user?color='+rgbC);
        }
        else {
            iconStr = 'icon-disabled-user';
            iconToggleStr = 'icon-history';
            toggleStr = t('cospend', 'Reactivate');
            imgurl = OC.generateUrl('/svg/core/actions/disabled-user?color='+rgbC);
        }


        var renameStr = t('cospend', 'Rename');
        var changeWeightStr = t('cospend', 'Change weight');
        var li =
            '<li memberid="'+member.id+'" class="memberitem'+invisibleClass+'">' +
            '    <a class="'+iconStr+'" style="background-image: url('+imgurl+')" href="#">' +
            '        <span>' +
            '            <b class="memberName">'+member.name+'</b> (x<b class="memberWeight">'+member.weight+'</b>) '+balanceStr+'' +
            '        </span>' +
            '    </a>' +
            '    <div class="app-navigation-entry-utils">' +
            '        <ul>' +
            '            <!--li class="app-navigation-entry-utils-counter">1</li-->' +
            '            <li class="app-navigation-entry-utils-menu-button memberMenuButton">' +
            '                <button></button>' +
            '            </li>' +
            '        </ul>' +
            '    </div>' +
            '    <div class="app-navigation-entry-menu">' +
            '        <ul>' +
            '            <li>' +
            '                <a href="#" class="renameMember">' +
            '                    <span class="icon-rename"></span>' +
            '                    <span>'+renameStr+'</span>' +
            '                </a>' +
            '            </li>' +
            '            <li>' +
            '                <a href="#" class="editWeightMember">' +
            '                    <span class="icon-rename"></span>' +
            '                    <span>'+changeWeightStr+'</span>' +
            '                </a>' +
            '            </li>' +
            '            <li>' +
            '                <a href="#" class="toggleMember">' +
            '                    <span class="'+iconToggleStr+'"></span>' +
            '                    <span>'+toggleStr+'</span>' +
            '                </a>' +
            '            </li>' +
            '        </ul>' +
            '    </div>' +
            '    <div class="app-navigation-entry-edit">' +
            '        <div>' +
            '            <input type="text" value="'+member.name+'" class="editMemberInput">' +
            '            <input type="submit" value="" class="icon-close editMemberClose">' +
            '            <input type="submit" value="" class="icon-checkmark editMemberOk">' +
            '        </div>' +
            '    </div>' +
            '</li>';

        $(li).appendTo('#projectlist li.projectitem[projectid='+projectid+'] .memberlist');
    }

    function onBillEdited() {
        // get bill info
        var billid = $('.bill-title').attr('billid');
        var projectid = $('.bill-title').attr('projectid');
        // check fields validity
        var valid = true;

        // if this is a new bill and custm amount is enabled : get out
        if (billid === '0' && $('#owerCustomAmount span').hasClass('icon-user-admin')) {
            return;
        }

        var what = $('.input-bill-what').val();
        var date = $('.input-bill-date').val();
        var amount = parseFloat($('.input-bill-amount').val());
        var payer_id = parseInt($('.input-bill-payer').val());
        var repeat = $('#repeatbill').val();
        var owerIds = [];
        var owerId;
        $('.owerEntry input').each(function() {
            if ($(this).is(':checked')) {
                owerId = parseInt($(this).attr('owerid'));
                if (isNaN(owerId)) {
                    valid = false;
                }
                else {
                    owerIds.push(owerId);
                }
            }
        });

        if (what === null || what === '') {
            valid = false;
        }
        if (date === null || date === '' || date.match(/^\d\d\d\d-\d\d-\d\d$/g) === null) {
            valid = false;
        }
        if (isNaN(amount) || isNaN(payer_id)) {
            valid = false;
        }
        if (owerIds.length === 0) {
            valid = false;
        }

        // if valid, save the bill or create it if needed
        if (valid) {
            if (billid === '0') {
                createBill(projectid, what, amount, payer_id, date, owerIds, repeat);
            }
            else {
                // if values have changed, save the bill
                var oldBill = cospend.bills[projectid][billid];
                // if ower lists don't have the same length, it has changed
                var owersChanged = (oldBill.owers.length !== owerIds.length);
                // same length : check content
                if (!owersChanged) {
                    for (var i=0; i < oldBill.owers.length; i++) {
                        if (owerIds.indexOf(oldBill.owers[i].id) === -1) {
                            owersChanged = true;
                            break;
                        }
                    }
                }
                if (oldBill.what !== what ||
                    oldBill.amount !== amount ||
                    oldBill.date !== date ||
                    oldBill.repeat !== repeat ||
                    oldBill.payer_id !== payer_id ||
                    owersChanged
                ) {
                    saveBill(projectid, billid, what, amount, payer_id, date, owerIds, repeat);
                }
            }
        }
        else {
            if (billid !== '0') {
                OC.Notification.showTemporary(t('cospend', 'Bill values are not valid'));
            }
        }
    }

    function saveOptionValue(optionValues) {
        if (!cospend.pageIsPublic) {
            var req = {
                options: optionValues
            };
            var url = OC.generateUrl('/apps/cospend/saveOptionValue');
            $.ajax({
                type: 'POST',
                url: url,
                data: req,
                async: true
            }).done(function (response) {
            }).fail(function() {
                OC.Notification.showTemporary(
                    t('cospend', 'Failed to save option values')
                );
            });
        }
    }

    function restoreOptions() {
        var mom;
        var url = OC.generateUrl('/apps/cospend/getOptionsValues');
        var req = {
        };
        var optionsValues = {};
        $.ajax({
            type: 'POST',
            url: url,
            data: req,
            async: true
        }).done(function (response) {
            optionsValues = response.values;
            if (optionsValues) {
                for (var k in optionsValues) {
                    if (k === 'selectedProject') {
                        cospend.restoredSelectedProjectId = optionsValues[k];
                    }
                }
            }
            // quite important ;-)
            main();
        }).fail(function() {
            OC.Notification.showTemporary(
                t('cospend', 'Failed to restore options values')
            );
        });
    }

    function addUserAutocompletion(input) {
        var req = {
        };
        var url = OC.generateUrl('/apps/cospend/getUserList');
        $.ajax({
            type: 'POST',
            url: url,
            data: req,
            async: true
        }).done(function (response) {
            cospend.userIdName = response.users;
            var nameList = [];
            var name;
            for (var id in response.users) {
                name = response.users[id];
                nameList.push(name);
            }
            input.autocomplete({
                source: nameList
            });
        }).fail(function() {
            OC.Notification.showTemporary(t('cospend', 'Failed to get user list'));
        });
    }

    function addUserShareDb(projectid, userid, username) {
        $('.projectitem[projectid='+projectid+']').addClass('icon-loading-small');
        var req = {
            projectid: projectid,
            userid: userid
        };
        var url = OC.generateUrl('/apps/cospend/addUserShare');
        $.ajax({
            type: 'POST',
            url: url,
            data: req,
            async: true
        }).done(function (response) {
            addUserShare(projectid, userid, username);
            var projectname = getProjectName(projectid);
            OC.Notification.showTemporary(t('cospend', 'Shared project {pname} with {uname}', {pname: projectname, uname: username}));
        }).always(function() {
            $('.projectitem[projectid='+projectid+']').removeClass('icon-loading-small');
        }).fail(function(response) {
            OC.Notification.showTemporary(t('cospend', 'Failed to add user share') + ' ' + response.responseText);
        });
    }

    function addUserShare(projectid, userid, username) {
        var li = '<li userid="'+escapeHTML(userid)+'" username="' + escapeHTML(username) + '">' +
            '<div class="shareLabel">' + t('cospend', 'Shared with {u}', {'u': username}) + '</div>' +
            '<div class="icon-delete deleteUserShareButton"></div></li>';
        $('.projectitem[projectid="' + projectid + '"] .app-navigation-entry-share').append(li);
        $('.projectitem[projectid="' + projectid + '"] .shareinput').val('');
    }

    function deleteUserShareDb(projectid, userid) {
        $('.projectitem[projectid="' + projectid + '"] .app-navigation-entry-share li[userid=' + userid + '] .deleteUserShareButton').addClass('icon-loading-small');
        var req = {
            projectid: projectid,
            userid: userid
        };
        var url = OC.generateUrl('/apps/cospend/deleteUserShare');
        $.ajax({
            type: 'POST',
            url: url,
            data: req,
            async: true
        }).done(function (response) {
            var li = $('.projectitem[projectid="' + projectid + '"] .app-navigation-entry-share li[userid=' + userid + ']');
            li.fadeOut('slow', function() {
                li.remove();
            });
        }).always(function() {
            $('.projectitem[projectid="' + projectid + '"] .app-navigation-entry-share li[userid=' + userid + '] .deleteUserShareButton').removeClass('icon-loading-small');
        }).fail(function(response) {
            OC.Notification.showTemporary(t('cospend', 'Failed to delete user share') + ' ' + response.responseText);
        });
    }

    function selectProject(projectitem) {
        var wasOpen = projectitem.hasClass('open');
        $('.projectitem.open').removeClass('open');
        if (!wasOpen) {
            projectitem.addClass('open');
            var projectid = projectitem.attr('projectid');

            saveOptionValue({selectedProject: projectid});
            cospend.currentProjectId = projectid;
            $('.projectitem').removeClass('selectedproject');
            $('.projectitem[projectid='+projectid+']').addClass('selectedproject');
            $('.app-navigation-entry-utils-counter').removeClass('highlighted');
            $('.projectitem[projectid='+projectid+'] .app-navigation-entry-utils-counter').addClass('highlighted');

            $('#billdetail').html('');
            getBills(projectid);
        }
    }

    function generatePublicLinkToFile(targetPath) {
        $('.loading-bill').addClass('icon-loading-small');
        var req = {
            path: targetPath
        };
        var url = OC.generateUrl('/apps/cospend/getPublicFileShare');
        $.ajax({
            type: 'POST',
            url: url,
            data: req,
            async: true
        }).done(function (response) {
            $('.loading-bill').removeClass('icon-loading-small');

            var filePublicUrl = window.location.protocol + '//' + window.location.hostname + OC.generateUrl('/s/'+response.token);

            var what = $('#what').val();
            what = what + ' ' + filePublicUrl;
            $('#what').val(what);
            onBillEdited();
        }).always(function() {
        }).fail(function(response) {
            $('.loading-bill').removeClass('icon-loading-small');
            OC.Notification.showTemporary(t('cospend', 'Failed to generate public link to file') + ' ' + response.responseText);
        });
    }

    function exportProject(projectid) {
        $('.projectitem[projectid='+projectid+']').addClass('icon-loading-small');
        var req = {
            projectid: projectid
        };
        var url = OC.generateUrl('/apps/cospend/exportCsvProject');
        $.ajax({
            type: 'POST',
            url: url,
            data: req,
            async: true
        }).done(function (response) {
            OC.Notification.showTemporary(t('cospend', 'Project exported in {path}', {path: response.path}));
        }).always(function() {
            $('.projectitem[projectid='+projectid+']').removeClass('icon-loading-small');
        }).fail(function(response) {
            OC.Notification.showTemporary(t('cospend', 'Failed to export project') + ' ' + response.responseText);
        });
    }

    function exportStatistics(projectid) {
        $('.exportStats[projectid='+projectid+'] span').addClass('icon-loading-small');
        var req = {
            projectid: projectid
        };
        var url = OC.generateUrl('/apps/cospend/exportCsvStatistics');
        $.ajax({
            type: 'POST',
            url: url,
            data: req,
            async: true
        }).done(function (response) {
            OC.Notification.showTemporary(t('cospend', 'Project statistics exported in {path}', {path: response.path}));
        }).always(function() {
            $('.exportStats[projectid='+projectid+'] span').removeClass('icon-loading-small');
        }).fail(function(response) {
            OC.Notification.showTemporary(t('cospend', 'Failed to export project statistics') + ' ' + response.responseText);
        });
    }

    function exportSettlement(projectid) {
        $('.exportSettlement[projectid='+projectid+'] span').addClass('icon-loading-small');
        var req = {
            projectid: projectid
        };
        var url = OC.generateUrl('/apps/cospend/exportCsvSettlement');
        $.ajax({
            type: 'POST',
            url: url,
            data: req,
            async: true
        }).done(function (response) {
            OC.Notification.showTemporary(t('cospend', 'Project settlement exported in {path}', {path: response.path}));
        }).always(function() {
            $('.exportSettlement[projectid='+projectid+'] span').removeClass('icon-loading-small');
        }).fail(function(response) {
            OC.Notification.showTemporary(t('cospend', 'Failed to export project settlement') + ' ' + response.responseText);
        });
    }

    function autoSettlement(projectid) {
        $('.autoSettlement[projectid='+projectid+'] span').addClass('icon-loading-small');
        var req = {
        };
        var url, type;
        if (!cospend.pageIsPublic) {
            req.projectid = projectid;
            url = OC.generateUrl('/apps/cospend/autoSettlement');
            type = 'POST';
        }
        else {
            url = OC.generateUrl('/apps/cospend/api/projects/'+cospend.projectid+'/'+cospend.password+'/autosettlement');
            type = 'GET';
        }
        $.ajax({
            type: type,
            url: url,
            data: req,
            async: true
        }).done(function (response) {
            updateProjectBalances(projectid);
            getBills(projectid);
            OC.Notification.showTemporary(t('cospend', 'Project settlement bills added'));
        }).always(function() {
            $('.autoSettlement[projectid='+projectid+'] span').removeClass('icon-loading-small');
        }).fail(function(response) {
            OC.Notification.showTemporary(t('cospend', 'Failed to add project settlement bills') + ' ' + response.responseText);
        });
    }

    function importProject(targetPath) {
        if (!endsWith(targetPath, '.csv')) {
            OC.Notification.showTemporary(t('cospend', 'Only CSV files can be imported'));
            return;
        }
        $('#addFileLinkButton').addClass('icon-loading-small');
        var req = {
            path: targetPath
        };
        var url = OC.generateUrl('/apps/cospend/importCsvProject');
        $.ajax({
            type: 'POST',
            url: url,
            data: req,
            async: true
        }).done(function (response) {
            $('#addFileLinkButton').removeClass('icon-loading-small');
            getProjects();
        }).always(function() {
        }).fail(function(response) {
            $('#addFileLinkButton').removeClass('icon-loading-small');
            OC.Notification.showTemporary(t('cospend', 'Failed to import project file') + ' ' + response.responseText);
        });
    }

    function updateCustomAmount() {
        var tot = 0;
        $('.customamountinput').each(function() {
            var val = parseFloat($(this).val());
            if (!isNaN(val) && val > 0.0) {
                tot = tot + val;
            }
        });
        $('#amount').val(tot);
    }

    function createCustomAmountBill() {
        var projectid = $('.bill-title').attr('projectid');

        var what = $('.input-bill-what').val();
        var date = $('.input-bill-date').val();
        var amount = parseFloat($('.input-bill-amount').val());
        var payer_id = parseInt($('.input-bill-payer').val());
        var repeat = 'n';

        var valid = true;

        if (what === null || what === '') {
            valid = false;
        }
        if (date === null || date === '' || date.match(/^\d\d\d\d-\d\d-\d\d$/g) === null) {
            valid = false;
        }
        if (isNaN(amount) || isNaN(payer_id)) {
            valid = false;
        }

        if (valid) {
            var total = 0;
            $('.customamountinput').each(function() {
                var owerId = parseInt($(this).attr('owerid'));
                var amountVal = parseFloat($(this).val());
                if (!isNaN(amountVal) && amountVal > 0.0) {
                    createBill(projectid, what, amountVal, payer_id, date, [owerId], repeat, true);
                    total = total + amountVal;
                }
            });
            // if something was actually created, clean up
            if (total > 0) {
                // empty bill detail
                $('#billdetail').html('');
                // remove new bill line
                $('.billitem[billid=0]').fadeOut('slow', function() {
                    $(this).remove();
                    if ($('.billitem').length === 0) {
                        $('#bill-list').html('<h2 class="nobill">'+t('cospend', 'No bill yet')+'</h2>');
                    }
                });
                $('.app-content-list').removeClass('showdetails');
            }
            else {
                OC.Notification.showTemporary(t('cospend', 'There is no custom amount'));
            }
        }
        else {
            OC.Notification.showTemporary(t('cospend', 'Invalid values'));
        }
    }

    $(document).ready(function() {
        cospend.pageIsPublic = (document.URL.indexOf('/cospend/project') !== -1);
        if ( !cospend.pageIsPublic ) {
            restoreOptions();
        }
        else {
            //restoreOptionsFromUrlParams();
            $('#newprojectbutton').hide();
            $('#importProjectButton').hide();
            cospend.projectid = $('#projectid').text();
            cospend.password = $('#password').text();
            cospend.restoredSelectedProjectId = cospend.projectid;
            $('#projectid').html('');
            $('#password').html('');
            main();
        }
    });

    function main() {
        // get key events
        document.onkeydown = checkKey;

        window.onclick = function(event) {
            if (!event.target.matches('.app-navigation-entry-utils-menu-button button')) {
                $('.app-navigation-entry-menu.open').removeClass('open');
            }
            if (!event.target.matches('.newmemberdiv, .newmemberdiv input, .newmemberdiv .newmemberbutton, .addMember, .addMember span')) {
                $('.newmemberdiv').slideUp();
            }
            //console.log(event.target);
        }

        $('body').on('focus','.shareinput', function(e) {
            $(this).select();
            addUserAutocompletion($(this));
        });

        $('body').on('keyup','.shareinput', function(e) {
            if (e.key === 'Enter') {
                var projectid = $(this).parent().parent().parent().attr('projectid');
                var username = $(this).val();
                var userId = '';
                for (var id in cospend.userIdName) {
                    if (username === cospend.userIdName[id]) {
                        userId = id;
                        break;
                    }
                }
                addUserShareDb(projectid, userId, username);
            }
        });

        $('body').on('click', '.deleteUserShareButton', function(e) {
            var projectid = $(this).parent().parent().parent().attr('projectid');
            var userid = $(this).parent().attr('userid');
            deleteUserShareDb(projectid, userid);
        });

        $('body').on('click', '.shareProjectButton', function(e) {
            var shareDiv = $(this).parent().parent().parent().find('.app-navigation-entry-share');
            if (shareDiv.is(':visible')) {
                shareDiv.slideUp();
            }
            else {
                shareDiv.slideDown();
                var defaultShareText = t('cospend', 'userName');
                $(this).parent().parent().parent().find('.shareinput').val(defaultShareText).focus().select();
            }
        });

        $('body').on('click', '.projectMenuButton, .memberMenuButton', function(e) {
            var wasOpen = $(this).parent().parent().parent().find('>.app-navigation-entry-menu').hasClass('open');
            $('.app-navigation-entry-menu.open').removeClass('open');
            if (!wasOpen) {
                $(this).parent().parent().parent().find('>.app-navigation-entry-menu').addClass('open');
            }
        });

        $('body').on('click', '.projectitem > a', function(e) {
            selectProject($(this).parent());
        });

        $('body').on('click', '.projectitem', function(e) {
            if (e.target.tagName === 'LI' && $(e.target).hasClass('projectitem')) {
                selectProject($(this));
            }
        });

        $('#newprojectbutton').click(function() {
            var div = $('#newprojectdiv');
            if (div.is(':visible')) {
                $(this).removeClass('icon-triangle-s').addClass('icon-triangle-e');
                div.slideUp('slow', function() {
                    $('#newBillButton').fadeIn();
                });
            }
            else {
                $(this).removeClass('icon-triangle-e').addClass('icon-triangle-s');
                div.slideDown('slow', function() {
                    $('#newBillButton').fadeOut();
                    $('#projectidinput').focus().select();
                });
            }
        });

        $('#projectnameinput, #projectidinput, #projectpasswordinput').on('keyup', function(e) {
            if (e.key === 'Enter') {
                var name = $('#projectnameinput').val();
                var id = $('#projectidinput').val();
                var password = $('#projectpasswordinput').val();
                if (name && id && password) {
                    createProject(id, name, password);
                }
                else {
                    OC.Notification.showTemporary(t('cospend', 'Invalid values'));
                }
            }
        });

        $('#newprojectform').submit(function(e) {
            var name = $('#projectnameinput').val();
            var id = $('#projectidinput').val();
            var password = $('#projectpasswordinput').val();
            if (name && id && password) {
                createProject(id, name, password);
            }
            else {
                OC.Notification.showTemporary(t('cospend', 'Invalid values'));
            }
            e.preventDefault();
        });

        $('#createproject').click(function() {
            var name = $('#projectnameinput').val();
            var id = $('#projectidinput').val();
            var password = $('#projectpasswordinput').val();
            if (name && id && password) {
                createProject(id, name, password);
            }
            else {
                OC.Notification.showTemporary(t('cospend', 'Invalid values'));
            }
        });

        $('body').on('click', '.deleteProject', function(e) {
            var projectid = $(this).parent().parent().parent().parent().attr('projectid');
            $(this).parent().parent().parent().parent().addClass('deleted');
            cospend.projectDeletionTimer[projectid] = new Timer(function() {
                deleteProject(projectid);
            }, 7000);
        });

        $('body').on('click', '.undoDeleteProject', function(e) {
            var projectid = $(this).parent().parent().attr('projectid');
            $(this).parent().parent().removeClass('deleted');
            cospend.projectDeletionTimer[projectid].pause();
            delete cospend.projectDeletionTimer[projectid];
        });

        $('body').on('click', '.addMember', function(e) {
            var projectid = $(this).parent().parent().parent().parent().attr('projectid');
            var name = $('.projectitem[projectid='+projectid+'] > a > span').text();

            var newmemberdiv = $('.projectitem[projectid='+projectid+'] .newmemberdiv');
            newmemberdiv.show().attr('style', 'display: inline-flex;');
            var defaultMemberName = t('cospend', 'newMemberName');
            newmemberdiv.find('.newmembername').val(defaultMemberName).focus().select();
        });

        $('body').on('click', '.newmemberbutton', function(e) {
            var projectid = $(this).parent().parent().attr('projectid');
            var name = $(this).parent().find('input').val();
            if (projectid && name) {
                createMember(projectid, name);
            }
            else {
                OC.Notification.showTemporary(t('cospend', 'Invalid values'));
            }
        });

        $('body').on('keyup', '.newmembername', function(e) {
            if (e.key === 'Enter') {
                var name = $(this).val();
                var projectid = $(this).parent().parent().attr('projectid');
                if (projectid && name) {
                    createMember(projectid, name);
                }
                else {
                    OC.Notification.showTemporary(t('cospend', 'Invalid values'));
                }
            }
        });

        $('body').on('click', '.renameMember', function(e) {
            var projectid = $(this).parent().parent().parent().parent().parent().parent().attr('projectid');
            var name = $(this).parent().parent().parent().parent().find('a > span > b.memberName').text();
            $(this).parent().parent().parent().parent().find('.editMemberInput').val(name).focus().select();
            $('.memberlist li').removeClass('editing');
            $(this).parent().parent().parent().parent().addClass('editing');
            cospend.memberEditionMode = MEMBER_NAME_EDITION;
        });

        $('body').on('click', '.editWeightMember', function(e) {
            var projectid = $(this).parent().parent().parent().parent().parent().parent().attr('projectid');
            var weight = $(this).parent().parent().parent().parent().find('a > span > b.memberWeight').text();
            $(this).parent().parent().parent().parent().find('.editMemberInput').val(weight).focus().select();
            $('.memberlist li').removeClass('editing');
            $(this).parent().parent().parent().parent().addClass('editing');
            cospend.memberEditionMode = MEMBER_WEIGHT_EDITION;
        });

        $('body').on('click', '.editMemberClose', function(e) {
            $(this).parent().parent().parent().removeClass('editing');
        });

        $('body').on('keyup', '.editMemberInput', function(e) {
            if (e.key === 'Enter') {
                var memberid = $(this).parent().parent().parent().attr('memberid');
                var projectid = $(this).parent().parent().parent().parent().parent().attr('projectid');
                if (cospend.memberEditionMode === MEMBER_NAME_EDITION) {
                    var newName = $(this).val();
                    editMember(projectid, memberid, newName, null, null);
                }
                else if (cospend.memberEditionMode === MEMBER_WEIGHT_EDITION) {
                    var newWeight = $(this).val();
                    var newName = $(this).parent().parent().parent().find('b.memberName').text();
                    editMember(projectid, memberid, newName, newWeight, null);
                }
            }
        });

        $('body').on('click', '.editMemberOk', function(e) {
            var memberid = $(this).parent().parent().parent().attr('memberid');
            var projectid = $(this).parent().parent().parent().parent().parent().attr('projectid');
            if (cospend.memberEditionMode === MEMBER_NAME_EDITION) {
                var newName = $(this).parent().find('.editMemberInput').val();
                editMember(projectid, memberid, newName, null, null);
            }
            else if (cospend.memberEditionMode === MEMBER_WEIGHT_EDITION) {
                var newWeight = $(this).parent().find('.editMemberInput').val();
                var newName = $(this).parent().parent().parent().find('b.memberName').text();
                editMember(projectid, memberid, newName, newWeight, null);
            }
        });

        $('body').on('click', '.toggleMember', function(e) {
            var memberid = $(this).parent().parent().parent().parent().attr('memberid');
            var projectid = $(this).parent().parent().parent().parent().parent().parent().attr('projectid');
            var newName = $(this).parent().parent().parent().parent().find('>a span b.memberName').text();
            var activated = $(this).find('span').first().hasClass('icon-history');
            editMember(projectid, memberid, newName, null, activated);
        });

        $('body').on('click', '.editProjectName', function(e) {
            var projectid = $(this).parent().parent().parent().parent().attr('projectid');
            var name = $(this).parent().parent().parent().parent().find('>a > span').text();
            $(this).parent().parent().parent().parent().find('.editProjectInput').val(name).attr('type', 'text').focus().select();
            $('#projectlist > li').removeClass('editing');
            $(this).parent().parent().parent().parent().removeClass('open').addClass('editing');
            cospend.projectEditionMode = PROJECT_NAME_EDITION;
        });

        $('body').on('click', '.editProjectPassword', function(e) {
            var projectid = $(this).parent().parent().parent().parent().attr('projectid');
            $(this).parent().parent().parent().parent().find('.editProjectInput').attr('type', 'password').val('').focus();
            $('#projectlist > li').removeClass('editing');
            $(this).parent().parent().parent().parent().removeClass('open').addClass('editing');
            cospend.projectEditionMode = PROJECT_PASSWORD_EDITION;
        });

        $('body').on('click', '.editProjectClose', function(e) {
            $(this).parent().parent().parent().removeClass('editing');
        });

        $('body').on('keyup', '.editProjectInput', function(e) {
            if (e.key === 'Enter') {
                var projectid = $(this).parent().parent().parent().attr('projectid');
                if (cospend.projectEditionMode === PROJECT_NAME_EDITION) {
                    var newName = $(this).val();
                    editProject(projectid, newName, null, null);
                }
                else if (cospend.projectEditionMode === PROJECT_PASSWORD_EDITION) {
                    var newPassword = $(this).val();
                    var newName = $(this).parent().parent().parent().find('>a span').text();
                    editProject(projectid, newName, null, newPassword);
                }
            }
        });

        $('body').on('click', '.editProjectOk', function(e) {
            var projectid = $(this).parent().parent().parent().attr('projectid');
            if (cospend.projectEditionMode === PROJECT_NAME_EDITION) {
                var newName = $(this).parent().find('.editProjectInput').val();
                editProject(projectid, newName, null, null);
            }
            else if (cospend.projectEditionMode === PROJECT_PASSWORD_EDITION) {
                var newPassword = $(this).parent().find('.editProjectInput').val();
                var newName = $(this).parent().parent().parent().find('>a span').text();
                editProject(projectid, newName, null, newPassword);
            }
        });

        $('body').on('click', '.billitem', function(e) {
            if (!$(e.target).hasClass('deleteBillIcon') && !$(e.target).hasClass('undoDeleteBill')) {
                var billid = parseInt($(this).attr('billid'));
                var projectid = $(this).attr('projectid');
                displayBill(projectid, billid);
            }
        });

        // what and amount : delay on edition
        $('body').on('keyup paste change', '.input-bill-what, .input-bill-amount', delay(function(e) {
            onBillEdited();
        }, 2000));

        // other bill fields : direct on edition
        $('body').on('change', '#billdetail input[type=checkbox], .input-bill-date, #billdetail select', function(e) {
            onBillEdited();
        });

        $('body').on('click', '#owerAll', function(e) {
            var projectid = $(this).parent().parent().parent().parent().parent().find('.bill-title').attr('projectid');
            for (var memberid in cospend.members[projectid]) {
                if (cospend.members[projectid][memberid].activated) {
                    $('.bill-owers input[owerid='+memberid+']').prop('checked', true);
                }
            }
            //$('.owerEntry input').prop('checked', true);
            onBillEdited();
        });

        $('body').on('click', '#owerNone', function(e) {
            var projectid = $(this).parent().parent().parent().parent().parent().find('.bill-title').attr('projectid');
            for (var memberid in cospend.members[projectid]) {
                if (cospend.members[projectid][memberid].activated) {
                    $('.bill-owers input[owerid='+memberid+']').prop('checked', false);
                }
            }
            //$('.owerEntry input').prop('checked', false);
            onBillEdited();
        });

        $('body').on('click', '.undoDeleteBill', function(e) {
            var billid = $(this).parent().attr('billid');
            cospend.billDeletionTimer[billid].pause();
            delete cospend.billDeletionTimer[billid];
            $(this).parent().find('.deleteBillIcon').show();
            $(this).parent().removeClass('deleted');
            $(this).hide();
        });

        $('body').on('click', '.deleteBillIcon', function(e) {
            var billid = $(this).parent().attr('billid');
            if (billid !== '0') {
                var projectid = $(this).parent().attr('projectid');
                $(this).parent().find('.undoDeleteBill').show();
                $(this).parent().addClass('deleted');
                $(this).hide();
                cospend.billDeletionTimer[billid] = new Timer(function() {
                    deleteBill(projectid, billid);
                }, 7000);
            }
            else {
                if ($('.bill-title').length > 0 && $('.bill-title').attr('billid') === billid) {
                    $('#billdetail').html('');
                }
                $(this).parent().fadeOut('slow', function() {
                    $(this).remove();
                    if ($('.billitem').length === 0) {
                        $('#bill-list').html('<h2 class="nobill">'+t('cospend', 'No bill yet')+'</h2>');
                    }
                });
            }
        });

        $('body').on('click', '#newBillButton', function(e) {
            var projectid = cospend.currentProjectId;
            var activatedMembers = [];
            for (var mid in cospend.members[projectid]) {
                if (cospend.members[projectid][mid].activated) {
                    activatedMembers.push(mid);
                }
            }
            if (activatedMembers.length > 1) {
                if (cospend.currentProjectId !== null && $('.billitem[billid=0]').length === 0) {
                    var bill = {
                        id: 0,
                        what: t('cospend', 'New Bill'),
                        date: moment().format('YYYY-MM-DD'),
                        amount: 0.0,
                        payer_id: 0,
                        repeat: 'n',
                        owers: []
                    };
                    addBill(projectid, bill)
                }
                displayBill(projectid, 0);
            }
            else {
                OC.Notification.showTemporary(t('cospend', '2 active members are required to create a bill'));
            }
        });

        $('body').on('focus', '.input-bill-what, .input-bill-amount, #projectidinput, #projectnameinput, #projectpasswordinput', function(e) {
            $(this).select();
        });

        $('#statsButton').click(function() {
            if (cospend.currentProjectId !== null) {
                getProjectStatistics(cospend.currentProjectId);
            }
        });

        $('#settleButton').click(function() {
            if (cospend.currentProjectId !== null) {
                getProjectSettlement(cospend.currentProjectId);
            }
        });

        $('body').on('click', '.getProjectStats', function(e) {
            var projectid = $(this).parent().parent().parent().parent().attr('projectid');
            getProjectStatistics(projectid);
        });

        $('body').on('click', '.getProjectSettlement', function(e) {
            var projectid = $(this).parent().parent().parent().parent().attr('projectid');
            getProjectSettlement(projectid);
        });

        $('body').on('click', '.copyExtProjectUrl', function() {
            var projectid = $(this).parent().parent().parent().parent().attr('projectid');
            var guestLink = OC.generateUrl('/apps/cospend/loginproject/'+projectid);
            guestLink = window.location.protocol + '//' + window.location.hostname + guestLink;
            var dummy = $('<input id="dummycopy">').val(guestLink).appendTo('body').select()
            document.execCommand('copy');
            $('#dummycopy').remove();
            OC.Notification.showTemporary(t('cospend', 'Guest link for \'{pid}\' copied to clipboard', {pid: projectid}));
        });

        var guestLink = OC.generateUrl('/apps/cospend/login');
        guestLink = window.location.protocol + '//' + window.location.hostname + guestLink;
        $('#generalGuestLinkButton').attr('title', guestLink);

        $('body').on('click', '#generalGuestLinkButton', function() {
            var guestLink = OC.generateUrl('/apps/cospend/login');
            guestLink = window.location.protocol + '//' + window.location.hostname + guestLink;
            var dummy = $('<input id="dummycopy">').val(guestLink).appendTo('body').select()
            document.execCommand('copy');
            $('#dummycopy').remove();
            OC.Notification.showTemporary(t('cospend', 'Guest link copied to clipboard'));
        });

        $('body').on('click', '#app-details-toggle', function() {
            $('.app-content-list').removeClass('showdetails');
        });

        $('body').on('click', '#addFileLinkButton', function() {
            OC.dialogs.filepicker(
                  t('cospend', 'Choose file'),
                  function(targetPath) {
                      generatePublicLinkToFile(targetPath);
                  },
                  false, null, true
              );
        });

        $('body').on('click', '#importProjectButton', function() {
            OC.dialogs.filepicker(
                  t('cospend', 'Choose csv project file'),
                  function(targetPath) {
                      importProject(targetPath);
                  },
                  false, null, true
              );
        });

        $('body').on('click', '.exportProject', function() {
            var projectid = $(this).parent().parent().parent().parent().attr('projectid');
            exportProject(projectid);
        });

        $('body').on('click', '.exportStats', function() {
            var projectid = $(this).attr('projectid');
            exportStatistics(projectid);
        });

        $('body').on('click', '.exportSettlement', function() {
            var projectid = $(this).attr('projectid');
            exportSettlement(projectid);
        });

        $('body').on('click', '.autoSettlement', function() {
            var projectid = $(this).attr('projectid');
            autoSettlement(projectid);
        });

        $('body').on('click', '#owerCustomAmount', function() {
            $('#owerCustomAmountValidate').toggle();
            $('#owerNone').toggle();
            $('#owerAll').toggle();
            $('.bill-owers .checkbox').toggle();
            $('.bill-owers .checkboxlabel').toggle();
            $('.bill-owers .numberlabel').toggle();
            $('.bill-owers input[type=number]').toggle();
            $('#owerCustomAmount span').toggleClass('icon-settings-dark').toggleClass('icon-user-admin');
            $('#amount').prop('disabled', function(i, v) {
                if (!v) {
                    updateCustomAmount();
                }
                else {
                    $('#amount').val('0');
                }
                return !v;
            });
            $('#repeatbill').val('n').prop('disabled', function(i, v) { return !v; });
        });

        $('body').on('paste change', '.customamountinput', function(e) {
            updateCustomAmount();
        });

        $('body').on('keyup','.customamountinput', function(e) {
            updateCustomAmount();
            if (e.key === 'Enter') {
                createCustomAmountBill();
            }
        });

        $('body').on('click', '#owerCustomAmountValidate', function() {
            updateCustomAmount();
            createCustomAmountBill();
        });

        // last thing to do : get the projects
        getProjects();
    }

})(jQuery, OC);
