/*!
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * This file is auto-generated. Do not modify it manually.
 * Changes to this file may be overwritten.
 */

export const dataSourcesInfo = {
  "ben_ltkactions": {
    "tableId": "",
    "version": "",
    "primaryKey": "ben_ltkactionid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "ben_ltkboardinstances": {
    "tableId": "",
    "version": "",
    "primaryKey": "ben_ltkboardinstanceid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "ben_ltkboards": {
    "tableId": "",
    "version": "",
    "primaryKey": "ben_ltkboardid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "ben_ltkcardcatalogs": {
    "tableId": "",
    "version": "",
    "primaryKey": "ben_ltkcardcatalogid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "ben_ltkcarddatas": {
    "tableId": "",
    "version": "",
    "primaryKey": "ben_ltkcarddataid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "ben_ltkpeoples": {
    "tableId": "",
    "version": "",
    "primaryKey": "ben_ltkpeopleid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "ben_ltksitesettingses": {
    "tableId": "",
    "version": "",
    "primaryKey": "ben_ltksitesettingsid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "ben_ltkuserprefses": {
    "tableId": "",
    "version": "",
    "primaryKey": "ben_ltkuserprefsid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "office365groups": {
    "tableId": "",
    "version": "",
    "primaryKey": "",
    "dataSourceType": "Connector",
    "apis": {
      "ListGroupMembers": {
        "path": "/{connectionId}/v1.0/groups/{groupId}/members",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "groupId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "$top",
            "in": "query",
            "required": false,
            "type": "integer"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "OnGroupMembershipChange": {
        "path": "/{connectionId}/trigger/v1.0/groups/delta",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "groupId",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "$select",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "array"
          }
        }
      },
      "AddMemberToGroup": {
        "path": "/{connectionId}/v1.0/groups/{groupId}/members/$ref",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "groupId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "userUpn",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "204": {
            "type": "void"
          }
        }
      },
      "ListOwnedGroups": {
        "path": "/{connectionId}/v1.0/me/memberOf/$/microsoft.graph.group",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "ListOwnedGroups_V2": {
        "path": "/{connectionId}/v1.0/me/ownedObjects/$/microsoft.graph.group",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "extractSensitivityLabel",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "fetchSensitivityLabelMetadata",
            "in": "query",
            "required": false,
            "type": "boolean"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "ListOwnedGroups_V3": {
        "path": "/{connectionId}/v2/v1.0/me/memberOf/$/microsoft.graph.group",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "extractSensitivityLabel",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "fetchSensitivityLabelMetadata",
            "in": "query",
            "required": false,
            "type": "boolean"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "ListGroups": {
        "path": "/{connectionId}/v1.0/groups",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "extractSensitivityLabel",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "fetchSensitivityLabelMetadata",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "$filter",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "$top",
            "in": "query",
            "required": false,
            "type": "integer"
          },
          {
            "name": "$skiptoken",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "CreateCalendarEvent": {
        "path": "/{connectionId}/v1.0/groups/{groupId}/events",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "groupId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "201": {
            "type": "object"
          }
        }
      },
      "CreateCalendarEventV2": {
        "path": "/{connectionId}/v2/v1.0/groups/{groupId}/events",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "groupId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "201": {
            "type": "object"
          }
        }
      },
      "CalendarDeleteItem_V2": {
        "path": "/{connectionId}/v1.0/groups/{groupId}/events/{event}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "groupId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "event",
            "in": "path",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "204": {
            "type": "void"
          },
          "default": {
            "type": "void"
          }
        }
      },
      "UpdateCalendarEvent": {
        "path": "/{connectionId}/v1.0/groups/{groupId}/events/{event}",
        "method": "PATCH",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "groupId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "event",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "RemoveMemberFromGroup": {
        "path": "/{connectionId}/v1.0/groups/{groupId}/members/memberId/$ref",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "groupId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "userUpn",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "204": {
            "type": "void"
          }
        }
      },
      "OnNewEvent": {
        "path": "/{connectionId}/trigger/v1.0/groups/{groupId}/events",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "groupId",
            "in": "path",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "array"
          }
        }
      },
      "HttpRequestV2": {
        "path": "/{connectionId}/v2/httprequest",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "Uri",
            "in": "header",
            "required": true,
            "type": "string"
          },
          {
            "name": "Method",
            "in": "header",
            "required": true,
            "type": "string"
          },
          {
            "name": "Body",
            "in": "body",
            "required": false,
            "type": "object"
          },
          {
            "name": "ContentType",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "CustomHeader1",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "CustomHeader2",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "CustomHeader3",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "CustomHeader4",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "CustomHeader5",
            "in": "header",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "default": {
            "type": "void"
          }
        }
      },
      "HttpRequest": {
        "path": "/{connectionId}/httprequest",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "Uri",
            "in": "header",
            "required": true,
            "type": "string"
          },
          {
            "name": "Method",
            "in": "header",
            "required": true,
            "type": "string"
          },
          {
            "name": "Body",
            "in": "body",
            "required": false,
            "type": "object"
          },
          {
            "name": "ContentType",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "CustomHeader1",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "CustomHeader2",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "CustomHeader3",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "CustomHeader4",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "CustomHeader5",
            "in": "header",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "default": {
            "type": "void"
          }
        }
      },
      "ListDeletedGroups": {
        "path": "/{connectionId}/v1.0/directory/deletedItems/microsoft.graph.group",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "RestoreDeletedGroup": {
        "path": "/{connectionId}/v1.0/directory/deletedItems/{groupId}/restore",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "groupId",
            "in": "path",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          }
        }
      },
      "ListDeletedGroupsByOwner": {
        "path": "/{connectionId}/v1.0/directory/deletedItems/getUserOwnedObjects",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "userId",
            "in": "header",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      }
    }
  },
  "office365users": {
    "tableId": "",
    "version": "",
    "primaryKey": "",
    "dataSourceType": "Connector",
    "apis": {
      "UpdateMyProfile": {
        "path": "/{connectionId}/codeless/v1.0/me",
        "method": "PATCH",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "default": {
            "type": "void"
          }
        }
      },
      "MyProfile_V2": {
        "path": "/{connectionId}/codeless/v1.0/me",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "$select",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "UpdateMyPhoto": {
        "path": "/{connectionId}/codeless/v1.0/me/photo/$value",
        "method": "PUT",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "Content-Type",
            "in": "header",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "default": {
            "type": "void"
          }
        }
      },
      "MyTrendingDocuments": {
        "path": "/{connectionId}/codeless/beta/me/insights/trending",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "$filter",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "extractSensitivityLabel",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "fetchSensitivityLabelMetadata",
            "in": "query",
            "required": false,
            "type": "boolean"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "RelevantPeople": {
        "path": "/{connectionId}/users/{userId}/relevantpeople",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "default": {
            "type": "void"
          }
        }
      },
      "MyProfile": {
        "path": "/{connectionId}/users/me",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "202": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "500": {
            "type": "void"
          },
          "default": {
            "type": "void"
          }
        }
      },
      "UserProfile": {
        "path": "/{connectionId}/users/{userId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "202": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "500": {
            "type": "void"
          },
          "default": {
            "type": "void"
          }
        }
      },
      "UserPhotoMetadata": {
        "path": "/{connectionId}/users/photo",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "userId",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "default": {
            "type": "void"
          }
        }
      },
      "UserPhoto": {
        "path": "/{connectionId}/users/photo/value",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "userId",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "string",
            "format": "binary"
          },
          "default": {
            "type": "void"
          }
        }
      },
      "Manager": {
        "path": "/{connectionId}/users/{userId}/manager",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "202": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "500": {
            "type": "void"
          },
          "default": {
            "type": "void"
          }
        }
      },
      "DirectReports": {
        "path": "/{connectionId}/users/{userId}/directReports",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "array"
          },
          "202": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "500": {
            "type": "void"
          },
          "default": {
            "type": "void"
          }
        }
      },
      "SearchUser": {
        "path": "/{connectionId}/users",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "searchTerm",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "top",
            "in": "query",
            "required": false,
            "type": "integer"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "array"
          },
          "202": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "500": {
            "type": "void"
          },
          "default": {
            "type": "void"
          }
        }
      },
      "SearchUserV2": {
        "path": "/{connectionId}/v2/users",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "searchTerm",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "top",
            "in": "query",
            "required": false,
            "type": "integer"
          },
          {
            "name": "isSearchTermRequired",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "skipToken",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "202": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "500": {
            "type": "void"
          },
          "default": {
            "type": "void"
          }
        }
      },
      "TestConnection": {
        "path": "/{connectionId}/testconnection",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "default": {
            "type": "void"
          }
        }
      },
      "UserProfile_V2": {
        "path": "/{connectionId}/codeless/v1.0/users/{id}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "$select",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "Manager_V2": {
        "path": "/{connectionId}/codeless/v1.0/users/{id}/manager",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "$select",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "DirectReports_V2": {
        "path": "/{connectionId}/codeless/v1.0/users/{id}/directReports",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "$select",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "$top",
            "in": "query",
            "required": false,
            "type": "integer"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "UserPhoto_V2": {
        "path": "/{connectionId}/codeless/v1.0/users/{id}/photo/$value",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "string",
            "format": "binary"
          }
        }
      },
      "TrendingDocuments": {
        "path": "/{connectionId}/codeless/beta/users/{id}/insights/trending",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "$filter",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "extractSensitivityLabel",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "fetchSensitivityLabelMetadata",
            "in": "query",
            "required": false,
            "type": "boolean"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "HttpRequest": {
        "path": "/{connectionId}/codeless/httprequest",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "Uri",
            "in": "header",
            "required": true,
            "type": "string"
          },
          {
            "name": "Method",
            "in": "header",
            "required": true,
            "type": "string"
          },
          {
            "name": "Body",
            "in": "body",
            "required": false,
            "type": "object"
          },
          {
            "name": "ContentType",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "CustomHeader1",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "CustomHeader2",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "CustomHeader3",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "CustomHeader4",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "CustomHeader5",
            "in": "header",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "default": {
            "type": "void"
          }
        }
      }
    }
  }
};
